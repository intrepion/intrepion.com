// Local tooling only. This worker is never deployed.
export default {
  async fetch(request, env) {
    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== "/query" ||
      request.headers.get("authorization") !== "Bearer local-d1-only"
    )
      return new Response(null, { status: 404 });
    try {
      const { sql, params } = await request.json();
      if (
        typeof sql !== "string" ||
        !Array.isArray(params) ||
        params.some((p) => typeof p !== "string")
      )
        return new Response(null, { status: 400 });
      const result = await env.DB.prepare(sql)
        .bind(...params)
        .all();
      return Response.json({ success: true, result: [result] });
    } catch {
      return Response.json(
        { success: false, errors: [{ code: 7500 }] },
        { status: 400 },
      );
    }
  },
};
