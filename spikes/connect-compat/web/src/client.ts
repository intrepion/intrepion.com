import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { CompatibilityService } from "./gen/spike/v1/compatibility_pb.ts";

// The browser and Node compatibility tests deliberately use the same transport.
export function compatibilityClient(useBinaryFormat = true) {
  return createClient(
    CompatibilityService,
    createConnectTransport({
      baseUrl: "http://127.0.0.1:4100",
      useBinaryFormat,
      defaultTimeoutMs: 5000,
    }),
  );
}
