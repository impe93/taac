"""Qwen3-ASR JSONL bridge for the TaacNotes realtime transcription sidecar.

Speaks newline-delimited JSON over stdio — one JSON object per line.
stdout carries protocol messages ONLY; all logging goes to stderr.

Requests (stdin):
  {"type": "init", "id": str, "model_path": str, "warmup": bool}
  {"type": "transcribe", "id": str, "pcm_b64": str, "language": str | null}
      pcm_b64: base64-encoded PCM s16le, 16 kHz, mono
      language: canonical language hint (e.g. "Italian") or null for auto-detect
  {"type": "shutdown"}

Responses (stdout):
  {"type": "ready", "id": str, "load_ms": int}
  {"type": "result", "id": str, "text": str, "language": str}
  {"type": "error", "id": str, "message": str}        (per-request, recoverable)
  {"type": "fatal", "message": str}                    (followed by exit 1)

The protocol is engine-agnostic: swapping the ASR library only touches this file.
"""

import base64
import json
import os
import sys
import time

# The model is always loaded from a local directory delivered by the app's
# ModelDownloader — never allow an implicit HuggingFace network fetch.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

SAMPLE_RATE = 16000


def emit(message: dict) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(text: str) -> None:
    sys.stderr.write(f"[qwen3_asr_bridge] {text}\n")
    sys.stderr.flush()


def fatal(message: str) -> None:
    emit({"type": "fatal", "message": message})
    sys.exit(1)


def decode_pcm(pcm_b64: str):
    import numpy as np

    raw = base64.b64decode(pcm_b64)
    if len(raw) % 2 != 0:
        raise ValueError(f"PCM byte length must be even (s16le), got {len(raw)}")
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def main() -> None:
    session = None

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            log(f"Discarding malformed request line: {exc}")
            continue

        request_type = request.get("type")
        request_id = request.get("id", "")

        if request_type == "init":
            try:
                import numpy as np
                from mlx_qwen3_asr import Session

                started = time.perf_counter()
                session = Session(request["model_path"])
                if request.get("warmup", True):
                    # 1s of silence forces Metal kernel compilation so the
                    # first real utterance is not slowed down.
                    session.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32))
                load_ms = int((time.perf_counter() - started) * 1000)
                log(f"Model ready from {request['model_path']} in {load_ms}ms")
                emit({"type": "ready", "id": request_id, "load_ms": load_ms})
            except Exception as exc:  # noqa: BLE001 — init failure is always fatal
                fatal(f"Model init failed: {exc}")

        elif request_type == "transcribe":
            if session is None:
                emit({"type": "error", "id": request_id, "message": "Not initialized"})
                continue
            try:
                audio = decode_pcm(request["pcm_b64"])
                result = session.transcribe(audio, language=request.get("language") or None)
                emit(
                    {
                        "type": "result",
                        "id": request_id,
                        "text": result.text,
                        "language": result.language or "",
                    }
                )
            except Exception as exc:  # noqa: BLE001 — keep serving later utterances
                emit({"type": "error", "id": request_id, "message": str(exc)})

        elif request_type == "shutdown":
            log("Shutdown requested")
            break

        else:
            log(f"Ignoring unknown request type: {request_type!r}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as exc:  # noqa: BLE001
        fatal(f"Unhandled bridge error: {exc}")
