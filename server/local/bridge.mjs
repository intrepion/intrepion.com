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
      const body = await request.json();
      const statements = body.batch ?? [body];
      if (
        !Array.isArray(statements) ||
        !statements.length ||
        statements.some(
          ({ sql, params }) =>
            typeof sql !== "string" ||
            !Array.isArray(params) ||
            params.some((p) => typeof p !== "string"),
        )
      )
        return new Response(null, { status: 400 });
      const prepared = statements.map(({ sql, params }) =>
        env.DB.prepare(sql).bind(...params),
      );
      const result = body.batch
        ? await env.DB.batch(prepared)
        : [await prepared[0].all()];
      return Response.json({ success: true, result });
    } catch {
      return Response.json(
        { success: false, errors: [{ code: 7500 }] },
        { status: 400 },
      );
    }
  },
};
