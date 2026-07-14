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

# mlx / mlx-metal ship SEPARATE wheels per macOS SDK (macosx_14_0, macosx_15_0,
# macosx_26_0). pip picks the most specific wheel for the BUILD host, so building
# on macOS 26 bundles the macosx_26_0 mlx-metal wheel whose mlx.metallib is stamped
# for the macOS 26 deployment target (Metal Shading Language 4.0). That library
# then FAILS to load on our minimum supported OS (macOS 14/15) — the sidecar aborts
# with SIGABRT: "Failed to load the default metallib ... language version 4.0 ...
# not supported on this OS". Pin mlx to the macosx_14_0 wheels (the lowest MLX
# supports) so the bundled runtime runs on every macOS ≥14, regardless of the
# build host's OS. See scripts note + docs/GENERAL_ARCHITECTURE_RULES.md.
MLX_VERSION="0.31.2"                      # must match what mlx-lm==0.31.3 resolves
MLX_WHEEL_PLATFORM="macosx_14_0_arm64"

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

# Pre-install the macOS 14 mlx / mlx-metal wheels BEFORE the main resolve, so the
# bundled mlx.metallib targets macOS 14 (loads on macOS 14/15+) even when this
# build host runs a newer macOS. --no-deps keeps this to just the two wheels; the
# main install below then finds mlx already satisfied and leaves them untouched.
PYVER="${PYTHON_VERSION%.*}"              # e.g. 3.12
PYABI="cp${PYVER//./}"                    # e.g. cp312 (matches the runtime's ABI)
WHEEL_DIR="$(mktemp -d)"
echo "[prepare-asr-runtime] Fetching ${MLX_WHEEL_PLATFORM} mlx wheels (macOS 14 target)..."
# mlx: C-extension wheel (cp<abi>); mlx-metal: py3-none wheel carrying the metallib.
"${RUNTIME_DIR}/bin/python3" -m pip download --no-cache-dir --disable-pip-version-check \
  --only-binary=:all: --no-deps --platform "${MLX_WHEEL_PLATFORM}" \
  --python-version "${PYVER}" --implementation cp --abi "${PYABI}" \
  -d "${WHEEL_DIR}" "mlx==${MLX_VERSION}"
"${RUNTIME_DIR}/bin/python3" -m pip download --no-cache-dir --disable-pip-version-check \
  --only-binary=:all: --no-deps --platform "${MLX_WHEEL_PLATFORM}" \
  --python-version "${PYVER}" --implementation py --abi none \
  -d "${WHEEL_DIR}" "mlx-metal==${MLX_VERSION}"
"${RUNTIME_DIR}/bin/python3" -m pip install --no-cache-dir --disable-pip-version-check \
  --no-deps "${WHEEL_DIR}"/*.whl
rm -rf "${WHEEL_DIR}"

echo "[prepare-asr-runtime] Installing ${ASR_PACKAGE}, ${LLM_PACKAGE}, ${TRANSFORMERS_PACKAGE}..."
# Explicit mlx / mlx-metal pins keep the resolver from upgrading the macOS 14
# wheels we just staged (they are already satisfied, so this is a no-op download).
"${RUNTIME_DIR}/bin/python3" -m pip install --no-cache-dir --disable-pip-version-check \
  "mlx==${MLX_VERSION}" "mlx-metal==${MLX_VERSION}" \
  "${ASR_PACKAGE}" "${LLM_PACKAGE}" "${TRANSFORMERS_PACKAGE}"

# Guardrail: fail the build if the bundled mlx / mlx-metal are NOT the macOS 14
# wheels (e.g. a resolver change re-pulled the build host's macosx_26 wheel). The
# platform tag is recorded in each dist-info/WHEEL file.
echo "[prepare-asr-runtime] Verifying bundled mlx wheels target ${MLX_WHEEL_PLATFORM}..."
for pkg in mlx mlx_metal; do
  wheel_meta="$(ls -d "${RUNTIME_DIR}"/lib/python*/site-packages/${pkg}-*.dist-info 2>/dev/null | head -1)"
  if [[ -z "${wheel_meta}" ]] || ! grep -q "${MLX_WHEEL_PLATFORM}" "${wheel_meta}/WHEEL"; then
    echo "[prepare-asr-runtime] ERROR: bundled ${pkg} is not the ${MLX_WHEEL_PLATFORM} wheel." >&2
    [[ -n "${wheel_meta}" ]] && grep '^Tag:' "${wheel_meta}/WHEEL" >&2
    echo "  A macosx_26 metallib crashes on macOS <26 (SIGABRT: metallib language version)." >&2
    exit 1
  fi
done

echo "[prepare-asr-runtime] Pruning caches and tests..."
find "${RUNTIME_DIR}" -type d -name '__pycache__' -prune -exec rm -rf {} +
find "${RUNTIME_DIR}/lib" -type d \( -name 'tests' -o -name 'test' -o -name 'idle_test' \) -prune -exec rm -rf {} +
rm -rf "${RUNTIME_DIR}/share"

echo "[prepare-asr-runtime] Smoke test..."
"${RUNTIME_DIR}/bin/python3" -c "import mlx_qwen3_asr, mlx_lm, numpy; print('mlx-qwen3-asr + mlx-lm OK')"

echo "[prepare-asr-runtime] Done → ${RUNTIME_DIR}/ ($(du -sh "${RUNTIME_DIR}" | cut -f1))"
