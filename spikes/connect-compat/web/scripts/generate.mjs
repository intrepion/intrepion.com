import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

execFileSync("protoc", [
  "-I", "../proto",
  "--plugin=protoc-gen-es=./node_modules/.bin/protoc-gen-es",
  "--es_out=src/gen",
  "--es_opt=target=ts,import_extension=js",
  "../proto/spike/v1/compatibility.proto",
], { stdio: "inherit" });

// Keep generated code deterministic and compliant with Git's EOF whitespace check.
const output = "src/gen/spike/v1/compatibility_pb.ts";
writeFileSync(output, readFileSync(output, "utf8").trimEnd() + "\n");
