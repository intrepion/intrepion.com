// Operator automation only. Never expose this credential to a browser bundle.
const token = process.env.HOUSEHOLD_MAINTENANCE_TOKEN;
if (!token || !/^[0-9a-f]{64}$/i.test(token))
  throw new Error("Configure the separate household maintenance credential.");
const origin = new URL(
  process.env.HOUSEHOLD_API_ORIGIN ?? "https://api.intrepion.com",
);
if (
  origin.protocol !== "https:" ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash ||
  origin.pathname !== "/"
)
  throw new Error("Household automation requires an exact HTTPS API origin.");
const response = await fetch(
  new URL("/life.v1.HouseholdMaintenanceService/EraseDueHouseholds", origin),
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
    `Household maintenance failed (HTTP ${response.status}). Retained allocations remain reserved; inspect the operator logs and retry.`,
  );
const result = await response.json();
console.log(
  JSON.stringify({
    event: "household_maintenance",
    protected_closures: result.protectedClosures ?? 0,
    erased_households: result.erasedHouseholds ?? 0,
  }),
);
