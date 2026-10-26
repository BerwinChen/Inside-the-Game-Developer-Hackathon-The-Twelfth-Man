#!/bin/sh
set -eu
forecast_project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -n "${FOOTBALL_PYTHON:-}" ]; then
    forecast_python=$FOOTBALL_PYTHON
elif [ -x "$forecast_project_dir/.venv/bin/python" ]; then
    forecast_python="$forecast_project_dir/.venv/bin/python"
else
    forecast_python=python3
fi
if ! "$forecast_python" -c 'import numpy' >/dev/null 2>&1; then
    echo 'Python 3.10+ and NumPy are required. See README.md or set FOOTBALL_PYTHON.' >&2
    exit 1
fi
export PYTHONPATH="$forecast_project_dir/src${PYTHONPATH:+:$PYTHONPATH}"
exec "$forecast_python" -B -m football_value "$@"
