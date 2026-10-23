# MVP 3 pilot operation

The pilot uses manually assigned finite resource plans, Google identities and a separate operator CLI. There is no public signup, operator web dashboard, checkout, billing expiry or automatic redistribution. Numerical production plans and structural caps require the owner's launch review after measuring existing retained usage and whole-database export overhead. The local examples are development fixtures and must not be applied to production.

## Credentials and environment

`PILOT_OPERATOR_TOKEN` is a separate 32-byte random secret encoded as 64 hex characters. Configure it in the server and the operator's environment, never in the web build, a review file or Git. It must differ from `HOUSEHOLD_MAINTENANCE_TOKEN`; the latter authorizes retention maintenance only. Google sessions and head authority do not authorize operator policy changes. An unconfigured operator endpoint refuses requests.

The CLI defaults to `https://api.intrepion.com`. `--local` binds it to `http://127.0.0.1:8788`. A saved review is bound to its API origin, so a local example cannot accidentally become a production assignment. No production credential, policy or workflow is configured by the implementation itself.

## Admission and policy previews

Run `node scripts/pilot-operator.mjs --help` for commands. `show SUBJECT` reads the current policy and revision. The subject is the exact Google identity identifier, rather than an email address; the approved person supplies their identifier through the operator-assisted admission process. Do not request Google passwords, cookies or identity tokens in chat. Sign-in still verifies Google's signature, issuer, audience, expiry and nonce before checking the approved registry.

For a new admission, prepare a JSON file with `subject`, `displayName`, `approved`, `createAccount: true`, `expectedRevision: "0"`, and `plan`. Specify all six plan resources explicitly: `items`, `shopping`, `templates`, `runs`, `bytes`, and `households`. Use non-negative safe whole values, as JSON numbers or decimal strings. Do not copy the illustrative prototype or local limits into a launch policy.

For an existing account, set `createAccount: false` and use its current revision. The same preview/apply process changes approval, display name or plan. Existing content is preserved when a genuine operator plan reduction leaves usage above a limit; viewing and explicit erasure remain available, while increases to exceeded dimensions are blocked. A lower household-membership limit preserves existing heads and blocks additional memberships until eligible.

Run `node scripts/pilot-operator.mjs preview POLICY.json`. This writes a mode-600 review file under the temporary directory and makes no changes. The file contains the exact request, current plan, affected spaces, before/after capacity and overage flags. Inspect it, then run `node scripts/pilot-operator.mjs apply REVIEW.json` to apply that exact preview. Use `--local` on both commands for development. Reuse the same review file after an uncertain response: the action identity and durable receipt prevent applying cuts twice. A stale policy or changed retained usage requires a new preview.

A plan change never silently chooses household cuts. Supply `replacements`, each containing `householdId`, that household's `expectedRevision`, and complete resource `amounts`. Replacements may retain or reduce that user's existing active-household allocation; ordinary head allocation controls handle increases. Only a genuine reduction of the corresponding plan resource permits a replacement to leave retained household usage over capacity; unchanged or increased dimensions must remain funded. The preview identifies household overages, and the transaction rechecks policy revisions, memberships, allocations and retained usage. Other heads see only changes to their own household's contribution and aggregate capacity, with an Operator entry in administrative History. Their contributor's private plan and other spaces stay private.

Closed-household allocations remain reserved until protected erasure succeeds. A proposed plan that cannot retain those allocations is not applicable yet. Wait for protected erasure or choose a policy that can retain them; do not bypass the closed-household hold with direct SQL.

## Structural policy

`show-structure` reports the current per-collection item/section limits, revision and observed retained maxima. Prepare a JSON file containing `maxItemsPerCollection` and `maxSectionsPerCollection`, then run `preview-structure LIMITS.json`. Inspect its saved current/proposed values and apply the review file explicitly. Lower limits preserve existing data; only growth beyond the applicable structural limit is blocked. Contributions never multiply these limits.

## Operator-assisted global erasure

Treat a global-erasure request separately from leaving, closing a household or revoking approval. Agree and record the requested scope before acting:

1. Identify the approved person's private data, current heads, retained contributions and pending erasures. A former head may inspect only their own retained allocation and withdrawal eligibility, without renewed content access.
2. Resolve active memberships through explicit departure/removal. Shared content and creator attribution remain for other heads unless a separately confirmed shared-content erasure covers them. Last-head departure permanently closes that household and schedules protected erasure at the confirmed UTC month boundary.
3. Obtain replacement capacity or explicitly erase retained content before voluntary withdrawal. Closed allocations wait for protected erasure. Do not claim global erasure is complete while these holds or pending protection remain unresolved.
4. Permanently erase the agreed private content through its protected erasure protocol, including associated content History. Verify the independent ledger and an isolated encrypted restore before claiming backup recovery cannot resurrect it.
5. Revoke pilot approval and remove remaining sessions. Retain the minimum disabled identity/attribution tombstone required by the agreed shared-History decision. The configured bootstrap owner must not be deleted in a way that silently readmits the same identity on the next login.

Document any retained shared attribution and content-free safety receipts with the requester. Revocation alone is an access change, not erasure of private content, shared content or other households. There is no self-service global-erasure control in MVP 3.
