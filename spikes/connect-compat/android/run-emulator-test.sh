#!/usr/bin/env bash
set -euo pipefail
command -v python3 >/dev/null || { echo 'FAIL: missing required tool: python3' >&2; exit 1; }
exec python3 "$(dirname -- "${BASH_SOURCE[0]}")/run_emulator_test.py"
