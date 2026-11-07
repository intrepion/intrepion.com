#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
for tool in protoc protoc-gen-swift protoc-gen-connect-swift; do
  command -v "$tool" >/dev/null || { echo "Missing $tool; see README.md for pinned local generators." >&2; exit 1; }
done
mkdir -p Sources/CompatibilitySpike/Generated
protoc -I ../proto \
  --swift_out=Sources/CompatibilitySpike/Generated --swift_opt=Visibility=Public \
  --connect-swift_out=Sources/CompatibilitySpike/Generated \
  --connect-swift_opt=Visibility=Public,GenerateAsyncMethods=true,GenerateCallbackMethods=false \
  ../proto/spike/v1/compatibility.proto
