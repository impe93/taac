#!/usr/bin/env bash
#
# prepare-asr-runtime.sh — build the bundled Python runtime for the MLX sidecars
# (macOS Apple Silicon only): realtime ASR (Qwen3-ASR) AND LLM text generation
# (mlx-lm). Both bridges share this one interpreter.
#
# Downloads python-build-standalone (arm64), installs the pinned MLX libraries
# into it and prunes what the sidecars do not need. The resulting
# python-runtime/ directory is shipped by electron-builder as an extraResource
# (see electron-builder.yml) and resolved at runtime by
# src/main/audio/realtime/pythonRuntime.ts.
#
# Usage: scripts/prepare-asr-runtime.sh          (from the repo root)
#        Skips work when python-runtime/ already exists and is valid.

set -euo pipefail

# Pinned versions — bump deliberately and re-run the Phase 0 spike checks.
# mlx-lm 0.31.3 requires mlx>=0.31.2, which satisfies mlx-qwen3-asr (mlx>=0.18);
# install both together so pip resolves a single compatible mlx.
PYTHON_BUILD_TAG="20250918"
PYTHON_VERSION="3.12.11"
ASR_PACKAGE="mlx-qwen3-asr==0.3.5"
LLM_PACKAGE="mlx-lm==0.31.3"
# Pin transformers: mlx-lm 0.31.3 only requires transformers>=5.0.0, but 5.13.0
# regressed AutoTokenizer.register (crashes on `import mlx_lm`). 5.12.1 works.
TRANSFORMERS_PACKAGE="transformers==5.12.1"

RUNTIME_DIR="python-runtime"
ARCHIVE_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_BUILD_TAG}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_TAG}-aarch64-apple-darwin-install_only_stripped.tar.gz"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "[prepare-asr-runtime] Skipping: realtime ASR runtime is macOS arm64 only"
  exit 0
fi

if [[ -x "${RUNTIME_DIR}/bin/python3" ]] \
  && "${RUNTIME_DIR}/bin/python3" -c "import mlx_qwen3_asr, mlx_lm" >/dev/null 2>&1; then
  echo "[prepare-asr-runtime] ${RUNTIME_DIR}/ already provisioned — skipping"
  exit 0
fi

echo "[prepare-asr-runtime] Downloading python-build-standalone ${PYTHON_VERSION} (${PYTHON_BUILD_TAG})..."
rm -rf "${RUNTIME_DIR}" python-runtime.tar.gz
curl -fL --retry 3 -o python-runtime.tar.gz "${ARCHIVE_URL}"

# The archive extracts to python/ — rename to python-runtime/
tar -xzf python-runtime.tar.gz
mv python "${RUNTIME_DIR}"
rm python-runtime.tar.gz

echo "[prepare-asr-runtime] Installing ${ASR_PACKAGE}, ${LLM_PACKAGE}, ${TRANSFORMERS_PACKAGE}..."
"${RUNTIME_DIR}/bin/python3" -m pip install --no-cache-dir --disable-pip-version-check \
  "${ASR_PACKAGE}" "${LLM_PACKAGE}" "${TRANSFORMERS_PACKAGE}"

echo "[prepare-asr-runtime] Pruning caches and tests..."
find "${RUNTIME_DIR}" -type d -name '__pycache__' -prune -exec rm -rf {} +
find "${RUNTIME_DIR}/lib" -type d \( -name 'tests' -o -name 'test' -o -name 'idle_test' \) -prune -exec rm -rf {} +
rm -rf "${RUNTIME_DIR}/share"

echo "[prepare-asr-runtime] Smoke test..."
"${RUNTIME_DIR}/bin/python3" -c "import mlx_qwen3_asr, mlx_lm, numpy; print('mlx-qwen3-asr + mlx-lm OK')"

echo "[prepare-asr-runtime] Done → ${RUNTIME_DIR}/ ($(du -sh "${RUNTIME_DIR}" | cut -f1))"
