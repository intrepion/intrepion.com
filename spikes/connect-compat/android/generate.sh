#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v java >/dev/null || { echo 'Java is required for the official Kotlin generator.' >&2; exit 1; }
command -v protoc >/dev/null || { echo 'protoc 36.2 is required.' >&2; exit 1; }
[[ $(protoc --version) == 'libprotoc 36.2' ]] || { echo 'Use protoc 36.2 with protobuf-java 4.36.2.' >&2; exit 1; }
[[ -f tools/protoc-gen-connect-kotlin-0.10.0.jar ]] || { echo 'Download and verify the official generator as described in README.md.' >&2; exit 1; }
mkdir -p generated
protoc -I ../proto --java_out=generated \
  --plugin=protoc-gen-connect-kotlin="$PWD/tools/protoc-gen-connect-kotlin" \
  --connect-kotlin_out=generated \
  ../proto/spike/v1/compatibility.proto
