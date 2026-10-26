// Disposable local review/test fixture through the same public API as the owner UI.
// These values never assign production policy or authorize launch thresholds.
export async function seedLocalNormalAccounts({ reuseExisting = false } = {}) {
  const origin = "http://127.0.0.1:4322",
    base = "http://127.0.0.1:8788";
  const challenge = await fetch(`${base}/auth/challenge`, {
    method: "POST",
    headers: { origin },
  });
  if (!challenge.ok) throw new Error("Local owner challenge failed");
  const { nonce } = await challenge.json();
  const login = await fetch(`${base}/auth/development`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      cookie: challenge.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; "),
    },
    body: JSON.stringify({ nonce, credential: "" }),
  });
  if (!login.ok) throw new Error("Local owner fixture login failed");
  const { csrf } = await login.json();
  const headers = {
    origin,
    "content-type": "application/json",
    "connect-protocol-version": "1",
    "x-csrf-token": csrf,
    cookie: login.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; "),
  };
  const rpc = async (method, body = {}) => {
    const r = await fetch(`${base}/life.v1.AccountAdminService/${method}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Local normal-account fixture ${method} failed`);
    return r.json();
  };
  const current = await rpc("GetPolicy");
  if (reuseExisting && current.enabled) return;
  const soft = {
    items: "800",
    shopping: "80",
    templates: "80",
    runs: "80",
    bytes: "8000000",
    households: "80",
  };
  const hard = {
    items: "1000",
    shopping: "100",
    templates: "100",
    runs: "100",
    bytes: "10000000",
    households: "100",
  };
  const change = {
    operationId: crypto.randomUUID(),
    expectedRevision: current.revision ?? "0",
    confirmed: true,
    policy: {
      enabled: true,
      personalSoft: soft,
      personalHard: hard,
      householdSoft: soft,
      householdHard: hard,
      maxItemsPerCollection: "1000",
      maxSectionsPerCollection: "100",
    },
  };
  const review = await rpc("PreviewPolicy", change);
  await rpc("ApplyPolicy", { ...change, previewToken: review.previewToken });
  const growth = await rpc("GetGrowth");
  await rpc("ChangeGrowth", {
    operationId: crypto.randomUUID(),
    expectedRevision: growth.revision ?? "0",
    paused: false,
    confirmed: true,
  });
}
