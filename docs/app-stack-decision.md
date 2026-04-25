# App Stack Decision

This document records the current technical direction for turning Intrepion from static artifacts into an Ambitions-first app.

It is a working decision, not a permanent architecture promise.

## Current Recommendation

Use this stack for the first real app shell and backend path:

- Client: Flutter.
- First app area: Ambitions only.
- Initial persistence: local seed data / local state.
- Backend language: Go.
- Backend transport: `net/http` with Connect RPC.
- Backend hosting: Google Cloud Run.
- Database: Neon Postgres.
- Object storage: Cloudflare R2.
- Auth: defer final choice; Firebase Auth or Google Identity are leading candidates.
- AI: defer implementation; route AI work through the backend when added.

## Why Flutter

Flutter is the leading client choice because Intrepion is intended to become a cross-platform personal app, not only a website.

Target platforms:

- Web.
- macOS.
- Linux.
- Windows.
- iOS.
- Android.

Flutter keeps the first app shell aligned with the long-term native-app goal while still allowing a web build.

## Why Go, net/http, And Connect RPC

Go is the leading backend choice because the first backend should be small, explicit, and easy to deploy.

The first backend does not need a large framework. It needs:

- Typed API contracts.
- Clear JSON/protobuf-shaped data.
- Fast deploys to Cloud Run.
- Simple connection to Neon Postgres.
- A clean path for AI/export work later.

`net/http` keeps the backend close to the standard library.

Connect RPC provides typed service contracts without requiring the project to adopt a heavier full-stack backend framework early.

## Why Neon Postgres

Neon Postgres is the preferred database direction because Intrepion's data is likely to become relational:

- Users.
- Ambitions.
- Records.
- Roadmap items.
- Check-ins.
- AI suggestions.
- Exports.
- Plans and entitlements.
- Households or families.
- Audit history.

The first app shell can still use local data. Neon should enter when the app needs real persistence, sync, or backend APIs.

## Why Cloud Run

Cloud Run is the preferred first hosting target for the Go backend because:

- It fits containerized Go services well.
- It avoids server management.
- It works with the user's remaining GCP trial credits.
- It leaves room to add background/export/AI services later.

Cloud Run should not be introduced before the app shell needs a backend.

## Why Cloudflare R2

Cloudflare R2 is the preferred object-storage direction for user files and generated artifacts because it is likely to be cheaper for egress-heavy use than Google Cloud Storage.

Likely future R2 objects:

- Portfolio screenshots.
- Artwork images.
- Receipts.
- Uploaded documents.
- Generated exports.
- Backups.

R2 should not be introduced before the product needs file storage.

## Deferred Choices

Do not decide these yet:

- Production auth provider.
- Payment provider.
- AI provider.
- Full database schema.
- Background job runner.
- Admin/support architecture.
- Multi-user household permissions.
- Mobile release process.

These decisions should follow from the Ambitions app shell and first backend needs.

## First App Shell Scope

The first Flutter app shell should include only:

- Ambitions list.
- `oliverforral.com` seeded from structured data.
- Ambition detail view.
- Records.
- Open decisions.
- Six-horizon roadmap.
- Next check-in.
- Generated summary.
- Local edit state.

It should exclude:

- Auth.
- Billing.
- Real AI.
- Neon writes.
- Cloud Run API calls.
- File uploads.
- R2 storage.
- Multi-user sharing.

## First Backend Scope

The first Go backend should come after the Flutter app shell feels useful.

Initial service:

```proto
service AmbitionsService {
  rpc ListAmbitions(ListAmbitionsRequest) returns (ListAmbitionsResponse);
  rpc GetAmbition(GetAmbitionRequest) returns (GetAmbitionResponse);
  rpc GenerateAmbitionExport(GenerateAmbitionExportRequest) returns (GenerateAmbitionExportResponse);
}
```

The first implementation may read seed JSON and generate Markdown without touching Neon.

Add Neon only when the service shape is clear.

## Revisit Triggers

Revisit this decision if:

- Flutter slows the app shell down more than expected.
- Go service code becomes too repetitive without a framework.
- Connect RPC causes friction with Flutter client generation.
- Neon free-tier limits become constraining.
- R2 integration creates more operational friction than GCS would.
- The product becomes mostly realtime collaboration, live support, or admin workflows.
- AI processing becomes Python-heavy enough to justify a separate FastAPI service.

## Current Product Bet

The next product risk is not the backend.

The next product risk is whether the Ambitions app shell is useful enough that Oliver wants to open it again tomorrow.

Build the Flutter Ambitions shell before building Cloud Run, Neon, R2, auth, or AI.
