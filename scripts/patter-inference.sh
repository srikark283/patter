#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then
  echo 'Usage: scripts/patter-inference.sh /absolute/path/to/mlx-model' >&2
  exit 1
fi
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PYTHON_BIN=${PATTER_MLX_PYTHON:-"$ROOT/../patter-model/.venv/bin/python3"}
# MLX's model-list endpoint expects the Hugging Face cache directory to exist,
# even when the model is loaded entirely from a local export.
"$PYTHON_BIN" -c 'from pathlib import Path; from huggingface_hub.constants import HF_HUB_CACHE; Path(HF_HUB_CACHE).mkdir(parents=True, exist_ok=True)'
exec "$PYTHON_BIN" -m mlx_lm server --model "$1" --host 127.0.0.1 --port 8081 --temp 0 --max-tokens 2048
