"""MLX-LM JSONL bridge for the TaacNotes LLM text-generation sidecar.

Speaks newline-delimited JSON over stdio — one JSON object per line.
stdout carries protocol messages ONLY; all logging goes to stderr.

A background reader thread consumes stdin so that `abort` requests are honoured
*while* a generation is streaming (the main worker thread is busy in the
stream_generate loop). Requests are otherwise processed sequentially via a queue.

Requests (stdin):
  {"type": "init", "id": str, "model_path": str, "warmup": bool}
  {"type": "generate", "id": str, "messages": [...], "tools": [...] | null,
   "max_tokens": int, "temperature": float, "top_p": float,
   "repetition_penalty": float | null, "enable_thinking": bool}
  {"type": "count_tokens", "id": str, "text": str}
  {"type": "abort", "id": str}          (cancels the matching in-flight generate)
  {"type": "shutdown"}

Responses (stdout):
  {"type": "ready", "id": str, "load_ms": int}
  {"type": "chunk", "id": str, "channel": "response" | "thought", "text": str}
  {"type": "done", "id": str, "prompt_tokens": int, "generation_tokens": int,
   "generation_tps": float, "finish_reason": str, "tool_calls": [...]}
  {"type": "token_count", "id": str, "count": int}
  {"type": "error", "id": str, "message": str}        (per-request, recoverable)
  {"type": "fatal", "message": str}                    (followed by exit 1)

The protocol is engine-agnostic: swapping the LLM library only touches this file.
"""

import json
import os
import queue
import sys
import threading
import time

# The model is always loaded from a local directory delivered by the app's
# ModelDownloader — never allow an implicit HuggingFace network fetch.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

THINK_OPEN = "<think>"
THINK_CLOSE = "</think>"
TOOL_OPEN = "<tool_call>"
TOOL_CLOSE = "</tool_call>"

_stdout_lock = threading.Lock()


def emit(message: dict) -> None:
    with _stdout_lock:
        sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def log(text: str) -> None:
    sys.stderr.write(f"[mlx_llm_bridge] {text}\n")
    sys.stderr.flush()


def fatal(message: str) -> None:
    emit({"type": "fatal", "message": message})
    sys.exit(1)


class StreamParser:
    """Split a token stream into 'thought' vs 'response' channels and extract
    Qwen3 <tool_call>{json}</tool_call> blocks (which are NOT streamed as
    response text). Handles delimiters that straddle token boundaries by holding
    back a small tail until it is known not to be a partial delimiter.
    """

    def __init__(self, request_id: str, enable_thinking: bool) -> None:
        self.request_id = request_id
        # When thinking is enabled the model opens with reasoning; the template
        # may or may not emit a literal <think> tag, so we start in 'thought'
        # only if requested and flip to 'response' on </think>.
        self.channel = "thought" if enable_thinking else "response"
        self.buf = ""  # held-back tail that may be a partial delimiter
        self.in_tool = False
        self.tool_buf = ""
        self.tool_calls: list = []
        self._max_delim = max(len(THINK_CLOSE), len(TOOL_OPEN), len(TOOL_CLOSE))

    def _emit_response(self, text: str) -> None:
        if text:
            emit(
                {
                    "type": "chunk",
                    "id": self.request_id,
                    "channel": "response",
                    "text": text,
                }
            )

    def _emit_thought(self, text: str) -> None:
        if text:
            emit(
                {
                    "type": "chunk",
                    "id": self.request_id,
                    "channel": "thought",
                    "text": text,
                }
            )

    def feed(self, delta: str) -> None:
        self.buf += delta
        # Process the buffer, keeping back a tail that could still grow into a
        # delimiter. We only consume up to len(buf) - (_max_delim - 1) safely,
        # unless a full delimiter is already present.
        while True:
            if self.in_tool:
                close = self.buf.find(TOOL_CLOSE)
                if close == -1:
                    # Keep accumulating tool JSON; retain a tail for a split tag.
                    keep = self._max_delim - 1
                    if len(self.buf) > keep:
                        self.tool_buf += self.buf[:-keep]
                        self.buf = self.buf[-keep:]
                    return
                self.tool_buf += self.buf[:close]
                self.buf = self.buf[close + len(TOOL_CLOSE):]
                self._finish_tool_call()
                self.in_tool = False
                continue

            # Look for the earliest meaningful delimiter in the current channel.
            if self.channel == "thought":
                close = self.buf.find(THINK_CLOSE)
                if close != -1:
                    self._emit_thought(self.buf[:close])
                    self.buf = self.buf[close + len(THINK_CLOSE):]
                    self.channel = "response"
                    continue
                self._flush_partial(self._emit_thought)
                return

            # response channel: watch for a tool-call opener
            tool_open = self.buf.find(TOOL_OPEN)
            if tool_open != -1:
                self._emit_response(self.buf[:tool_open])
                self.buf = self.buf[tool_open + len(TOOL_OPEN):]
                self.in_tool = True
                self.tool_buf = ""
                continue
            self._flush_partial(self._emit_response)
            return

    def _flush_partial(self, emit_fn) -> None:
        """Emit everything except a trailing tail that might be a partial
        delimiter opener."""
        keep = self._max_delim - 1
        if len(self.buf) > keep:
            emit_fn(self.buf[:-keep])
            self.buf = self.buf[-keep:]

    def _finish_tool_call(self) -> None:
        raw = self.tool_buf.strip()
        self.tool_buf = ""
        try:
            parsed = json.loads(raw)
            self.tool_calls.append(parsed)
        except json.JSONDecodeError:
            log(f"Discarding unparseable tool_call block: {raw[:200]!r}")

    def finalize(self) -> None:
        """Flush any remaining buffered text at end of generation."""
        if self.in_tool:
            # Unterminated tool call — try to salvage.
            self.tool_buf += self.buf
            self.buf = ""
            self._finish_tool_call()
            return
        if self.channel == "thought":
            self._emit_thought(self.buf)
        else:
            self._emit_response(self.buf)
        self.buf = ""


class Bridge:
    def __init__(self) -> None:
        self.model = None
        self.tokenizer = None
        self._mlx = {}
        self._cancelled = set()
        self._cancel_lock = threading.Lock()
        self._shutdown = False
        self._requests: "queue.Queue[dict | None]" = queue.Queue()

    # -- stdin reader thread -------------------------------------------------
    def _read_stdin(self) -> None:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except json.JSONDecodeError as exc:
                log(f"Discarding malformed request line: {exc}")
                continue

            rtype = request.get("type")
            if rtype == "abort":
                # Honour immediately, even mid-generation.
                with self._cancel_lock:
                    self._cancelled.add(request.get("id", ""))
            elif rtype == "shutdown":
                self._shutdown = True
                self._requests.put(None)  # unblock the worker
                return
            else:
                self._requests.put(request)

        # stdin reached EOF — the parent (Electron main) process is gone. Signal
        # the worker to exit so we never linger as an orphaned process. Without
        # this the worker would block forever on queue.get() after the pipe
        # closes (e.g. when the app's hard-timeout forces quit before sending a
        # graceful shutdown).
        self._shutdown = True
        self._requests.put(None)

    def _is_cancelled(self, request_id: str) -> bool:
        with self._cancel_lock:
            return request_id in self._cancelled

    def _clear_cancel(self, request_id: str) -> None:
        with self._cancel_lock:
            self._cancelled.discard(request_id)

    # -- request handlers ----------------------------------------------------
    def _handle_init(self, request: dict) -> None:
        try:
            import mlx_lm
            from mlx_lm.sample_utils import make_sampler

            self._mlx["mlx_lm"] = mlx_lm
            self._mlx["make_sampler"] = make_sampler
            try:
                from mlx_lm.sample_utils import make_logits_processors

                self._mlx["make_logits_processors"] = make_logits_processors
            except Exception:  # noqa: BLE001 — optional across versions
                self._mlx["make_logits_processors"] = None

            started = time.perf_counter()
            # mlx-lm loads the text decoder of the Qwen3.5 omni checkpoint only,
            # so the vision tower never enters memory.
            self.model, self.tokenizer = mlx_lm.load(request["model_path"])
            if request.get("warmup", True):
                self._warmup()
            load_ms = int((time.perf_counter() - started) * 1000)
            log(f"Model ready from {request['model_path']} in {load_ms}ms")
            emit({"type": "ready", "id": request.get("id", "init"), "load_ms": load_ms})
        except Exception as exc:  # noqa: BLE001 — init failure is always fatal
            fatal(f"Model init failed: {exc}")

    def _warmup(self) -> None:
        try:
            prompt = self.tokenizer.apply_chat_template(
                [{"role": "user", "content": "hi"}],
                add_generation_prompt=True,
                tokenize=False,
            )
            for _ in self._mlx["mlx_lm"].stream_generate(
                self.model, self.tokenizer, prompt, max_tokens=1
            ):
                break
        except Exception as exc:  # noqa: BLE001 — warmup is best-effort
            log(f"Warmup skipped: {exc}")

    def _build_prompt(self, messages: list, tools, enable_thinking: bool) -> str:
        kwargs = dict(add_generation_prompt=True, tokenize=False)
        if tools:
            kwargs["tools"] = tools
        # enable_thinking is Qwen-specific; ignore if the template rejects it.
        try:
            return self.tokenizer.apply_chat_template(
                messages, enable_thinking=enable_thinking, **kwargs
            )
        except TypeError:
            return self.tokenizer.apply_chat_template(messages, **kwargs)

    def _handle_generate(self, request: dict) -> None:
        request_id = request.get("id", "")
        if self.model is None:
            emit({"type": "error", "id": request_id, "message": "Not initialized"})
            return
        self._clear_cancel(request_id)
        try:
            enable_thinking = bool(request.get("enable_thinking", True))
            prompt = self._build_prompt(
                request.get("messages", []),
                request.get("tools"),
                enable_thinking,
            )

            make_sampler = self._mlx["make_sampler"]
            sampler = make_sampler(
                temp=float(request.get("temperature", 0.7)),
                top_p=float(request.get("top_p", 1.0) or 1.0),
            )
            gen_kwargs = dict(
                max_tokens=int(request.get("max_tokens", 2048)),
                sampler=sampler,
            )
            rep = request.get("repetition_penalty")
            mlp = self._mlx.get("make_logits_processors")
            if rep and mlp is not None:
                gen_kwargs["logits_processors"] = mlp(repetition_penalty=float(rep))

            parser = StreamParser(request_id, enable_thinking)
            finish_reason = "stop"
            prompt_tokens = 0
            generation_tokens = 0
            generation_tps = 0.0

            for response in self._mlx["mlx_lm"].stream_generate(
                self.model, self.tokenizer, prompt, **gen_kwargs
            ):
                if self._shutdown or self._is_cancelled(request_id):
                    # Abort on explicit cancel OR parent death (stdin EOF), so an
                    # in-flight generation cannot keep an orphan alive.
                    finish_reason = "aborted"
                    break
                parser.feed(response.text)
                prompt_tokens = getattr(response, "prompt_tokens", prompt_tokens)
                generation_tokens = getattr(
                    response, "generation_tokens", generation_tokens
                )
                generation_tps = getattr(response, "generation_tps", generation_tps)
                if getattr(response, "finish_reason", None):
                    finish_reason = response.finish_reason

            parser.finalize()
            self._clear_cancel(request_id)
            emit(
                {
                    "type": "done",
                    "id": request_id,
                    "prompt_tokens": int(prompt_tokens),
                    "generation_tokens": int(generation_tokens),
                    "generation_tps": float(generation_tps),
                    "finish_reason": finish_reason,
                    "tool_calls": parser.tool_calls,
                }
            )
        except Exception as exc:  # noqa: BLE001 — keep serving later requests
            emit({"type": "error", "id": request_id, "message": str(exc)})

    def _handle_count_tokens(self, request: dict) -> None:
        request_id = request.get("id", "")
        if self.tokenizer is None:
            emit({"type": "error", "id": request_id, "message": "Not initialized"})
            return
        try:
            count = len(self.tokenizer.encode(request.get("text", "")))
            emit({"type": "token_count", "id": request_id, "count": int(count)})
        except Exception as exc:  # noqa: BLE001
            emit({"type": "error", "id": request_id, "message": str(exc)})

    # -- main worker loop ----------------------------------------------------
    def run(self) -> None:
        reader = threading.Thread(target=self._read_stdin, daemon=True)
        reader.start()

        while True:
            request = self._requests.get()
            if request is None or self._shutdown:
                log("Shutdown requested")
                return
            rtype = request.get("type")
            if rtype == "init":
                self._handle_init(request)
            elif rtype == "generate":
                self._handle_generate(request)
            elif rtype == "count_tokens":
                self._handle_count_tokens(request)
            else:
                log(f"Ignoring unknown request type: {rtype!r}")


if __name__ == "__main__":
    try:
        Bridge().run()
    except KeyboardInterrupt:
        pass
    except Exception as exc:  # noqa: BLE001
        fatal(f"Unhandled bridge error: {exc}")
