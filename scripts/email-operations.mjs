// Private operator automation. This token permits queue processing only.
const token = process.env.EMAIL_OPERATIONS_TOKEN;
if (!token || !/^[a-f0-9]{64}$/i.test(token))
  throw new Error("Configure the separate email operations credential.");
const origin = new URL(
  process.env.EMAIL_API_ORIGIN || "https://api.intrepion.com",
);
if (
  origin.protocol !== "https:" ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash ||
  origin.pathname !== "/"
)
  throw new Error("Email operations require an exact HTTPS API origin.");
const response = await fetch(
  new URL("/life.v1.EmailOperationsService/ProcessQueue", origin),
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "connect-protocol-version": "1",
    },
    body: "{}",
    redirect: "error",
    signal: AbortSignal.timeout(10 * 60 * 1000),
  },
);
if (!response.ok)
  throw new Error(
    `Email operations failed (HTTP ${response.status}). Review the owner Admin page; no credentials or private email content are printed here.`,
  );
const result = await response.json();
const count = (value) => {
  const text = String(value ?? "0");
  if (
    !/^(0|[1-9][0-9]{0,15})$/.test(text) ||
    BigInt(text) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error("Invalid email operations counters.");
  return Number(text);
};
if (
  !result ||
  typeof result !== "object" ||
  Array.isArray(result) ||
  (result.warning !== undefined && typeof result.warning !== "boolean")
)
  throw new Error("Invalid email operations result.");
const attempted = count(result.attempted),
  monthly = count(result.monthlyAttempts);
console.log(
  JSON.stringify({
    event: "email_operations",
    attempted,
    monthly_attempts: monthly,
  }),
);
// Processing and durable accounting finish before raising the notification.
if (result.warning || monthly >= 8000) {
  console.warn(
    "::warning::The email attempt allowance needs owner review (80% or more used, or a conservative recovery hold). Existing valid delivered invitations can still be accepted when growth is open.",
  );
  process.exitCode = 1;
}
