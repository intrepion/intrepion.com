#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CARGO_TARGET_DIR="$PWD/rust/target"
export npm_config_cache="$PWD/web/.npm-cache"
export npm_config_update_notifier=false

for tool in cargo node npm protoc python3; do
  command -v "$tool" >/dev/null || { echo "Missing $tool; see README.md." >&2; exit 1; }
done
[[ -d web/node_modules ]] || { echo 'First run: (cd web && npm ci --ignore-scripts --cache .npm-cache)' >&2; exit 1; }

work=$(mktemp -d)
server_pid=''
cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cargo fmt --manifest-path rust/Cargo.toml --check
cargo clippy --locked --manifest-path rust/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path rust/Cargo.toml
cargo build --locked --manifest-path rust/Cargo.toml --bins
cp web/src/gen/spike/v1/compatibility_pb.ts "$work/compatibility_pb.ts"
(cd web && npm run generate && npm run typecheck && npm run build)
cmp "$work/compatibility_pb.ts" web/src/gen/spike/v1/compatibility_pb.ts || {
  echo 'Generated TypeScript changed; review the refreshed file and rerun.' >&2
  exit 1
}

# Keep clients and service in the same execution/network context. The process
# must successfully bind itself; do not accidentally test an existing server.
"$CARGO_TARGET_DIR/debug/server" >"$work/server.log" 2>&1 &
server_pid=$!
ready=false
for _ in {1..50}; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$work/server.log" >&2
    echo 'Could not start test service. Ensure local port 4100 is free.' >&2
    exit 1
  fi
  if grep -q 'Dummy ConnectRPC service:' "$work/server.log"; then
    ready=true
    break
  fi
  sleep 0.1
done
[[ "$ready" == true ]] || { cat "$work/server.log" >&2; echo 'Server startup timed out.' >&2; exit 1; }
"$CARGO_TARGET_DIR/debug/client"
(cd web && npm run test:integration)
bash -n android/generate.sh android/run-emulator-test.sh ios/generate.sh
python3 -m unittest discover -s android -p test_run_emulator_test.py -v
sh -n android/tools/protoc-gen-connect-kotlin
printf '\nPASS: Rust and web SDK transport checks. Native mobile and real-browser checks are not included.\n'
