// A local-development shim, not Cloudflare's REST implementation.
// Native Rust calls this over HTTP; SQL executes in Wrangler's actual local D1.
export default {
  async fetch(request, env) {
    if (env.EXPERIMENT_LOCAL_ONLY !== "true") return new Response("local experiment disabled", { status: 503 });
    if (request.method !== "POST" || new URL(request.url).pathname !== "/client/v4/accounts/local/d1/database/local/query") {
      return new Response("not found", { status: 404 });
    }
    if (request.headers.get("authorization") !== "Bearer local-d1-token") {
      return Response.json({ success: false, errors: [{ code: 10000, message: "Authentication error" }], result: [] }, { status: 403 });
    }
    const { sql, params = [] } = await request.json();
    // Match the documented REST string-parameter subset. Worker bindings accept
    // more types; allowing those here would overstate what REST was validated.
    if (typeof sql !== "string" || !Array.isArray(params) || params.some(value => typeof value !== "string")) {
      return Response.json({ success: false, errors: [{ code: 10001, message: "Invalid query envelope" }], result: [] }, { status: 400 });
    }
    try {
      const result = await env.DB.prepare(sql).bind(...params).all();
      return Response.json({ success: true, errors: [], messages: [], result: [result] });
    } catch {
      // Error fixtures exercise additional provider envelopes in the Rust tests.
      // Do not forward SQL or bound values into public responses or logs.
      return Response.json({ success: false, errors: [{ code: 7500, message: "Local database query failed" }], result: [] }, { status: 400 });
    }
  },
};
