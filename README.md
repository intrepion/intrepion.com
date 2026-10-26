# intrepion.com

A personal task app as the first MVP of a future Life OS. The initial delivery is a Rust API and an Astro/TypeScript web client; other clients and AI agents are deferred.

- [Agreed MVP plan and delivery gates](docs/mvp-plan.md)
- [MVP 2 Everyday lists scope](docs/mvp-2-plan.md), [approved designs](design/mvp-2/README.md), and [approved standalone prototype](design/mvp-2/PROTOTYPE.md)
- [MVP 3 Household foundation scope](docs/mvp-3-plan.md), [designs](design/mvp-3/README.md), [standalone prototype](design/mvp-3/PROTOTYPE.md), and [implementation checks](docs/mvp-3-implementation.md)
- [MVP 3.1 normal invitations scope](docs/mvp-3-1-plan.md), [implementation checks](docs/mvp-3-1-implementation.md), [final review](docs/mvp-3-1-review.md), and [release preparation](docs/mvp-3-1-release.md)
- [Measured MVP 3 usage and approved pilot limits](docs/mvp-3-sizing.md), [release preparation](docs/mvp-3-release.md), [hosted rehearsal evidence](docs/mvp-3-rehearsal.md)
- [Pilot operator tools](docs/mvp-3-operator.md) and [household retention](docs/mvp-3-retention.md)
- [Domain glossary](GLOSSARY.md)
- [Hosting comparison](docs/hosting-assessment.md)
- [GitHub-only backup monitoring plan](docs/monitoring-assessment.md)
- [Workers/ConnectRPC/D1 feasibility results](docs/experiments/0001-workers-connect-d1.md)
- [Native Axum/D1 feasibility results](docs/experiments/0002-native-axum-d1.md)
- [Run the isolated local experiment](experiments/workers-connect-d1/README.md)
- [Run the native Axum/D1 experiment](experiments/native-axum-d1/README.md)
- [Review the MVP wireframes](design/mvp-1/wireframes.html) ([image overview](design/mvp-1/wireframes-overview.png))
- [Review the visual mockups](design/mvp-1/mockups.html) ([desktop](design/mvp-1/mockup-desktop.png), [mobile](design/mvp-1/mockup-mobile.png))
- [Run and review the standalone Astro prototype](prototype/README.md)
- [Run the production Rust API](server/README.md) and [Astro client](web/README.md)
- [Deployment, backups, monitoring, and launch evidence](docs/operations.md)

Wireframes (Q35), mockups (Q36), and prototype interactions (Q37) are approved. The separate Rust/Axum API and Astro client implement the task workflow, durable D1 storage, Google owner sessions, and local development authentication. GitHub Actions definitions cover CI, manual deployment of a passing revision, encrypted backups, and an independent backup-age check. The task MVP launched at [intrepion.com](https://intrepion.com) with Google owner-only access. Hosted task persistence, encrypted offsite recovery through the API, and private failure-email delivery passed. See the operations record for the deployed revision, timing samples, and accepted free-hosting limits.

MVP 2 Everyday lists is live at [intrepion.com](https://intrepion.com): shopping lists, reusable checklist templates, independent runs, History, Archive, Trash and erasure-aware recovery. See the [implementation checks](docs/mvp-2-implementation.md), [review record](docs/mvp-2-review.md), and [hosted release procedure](docs/mvp-2-release.md). The maintenance upgrade, hosted workflow checks, and isolated encrypted recovery drill passed.

For the production application's local development stack, install Rust, Node and `protoc`, run `npm ci` and `npm --prefix web ci` once, then `npm run dev` and open <http://127.0.0.1:4322>. The server uses local D1 and two approved development identities; local data survives restarts. Finite development plans are illustrative and preserve configured local policy. They are not production limits.

For local MVP 3.1 review, use `npm run dev:normal` and the same app URL. It uses separate persistent local state, name-only households, owner Admin controls, and a fake mailbox at <http://127.0.0.1:8793/mailbox>. Invite only `@example.invalid` development addresses; no real email is sent. Illustrative local safety values do not set production thresholds. Stop development before integration or browser tests, which share its ports.

The separate prototype remains server-free: run `npm --prefix prototype ci` once, then `npm --prefix prototype run dev` and open <http://127.0.0.1:4321>. Its synthetic data resets on reload. Prototype application code is not shared with production. Themes, AI, other login methods, and the reserved Android/iOS/CLI/desktop clients remain later-MVP work.
