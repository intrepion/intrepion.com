# Backup monitoring choices

Checked 2026-10-20. The owner selected GitHub-only monitoring for MVP 1 and accepted the shared-scheduler blind spot. External services below are researched alternatives for future reconsideration. Only permanent free plans count; introductory paid-plan trials do not count.

The accepted requirement is a monitoring workflow separate from the backup workflow that emails the owner when verified backup completion is stale or missing, provided the monitoring workflow runs. Independence from GitHub's scheduling platform is explicitly deferred. Ordinary application error reporting cannot detect a job that never executes. Send no task contents, backup contents, credentials, or decryption keys to the monitor.

| Service | Recurring free allowance | Fit |
| --- | --- | --- |
| GitHub Actions | Standard runners are free in public repositories; storage and external API quotas still apply | Reuse existing tooling with a separate stale-backup watchdog; shares GitHub scheduling failures with the backup job. |
| Healthchecks.io Hobbyist | 20 monitored jobs; 100 retained log entries per job | Focused job monitoring with room for separate backup and restore-verification checks, and future scheduled work. |
| Sentry Developer Crons | One cron monitor; additional monitors require upgrading to a paid plan | Enough for the initial daily backup job; useful if the owner prefers one service for application errors and scheduled-job monitoring. |
| Cronitor Hacker | Five monitors; email and chat alerts | A permanent free alternative combining scheduled jobs, heartbeats, and website/API checks. |

Sources: [Healthchecks plans](https://healthchecks.io/pricing/), [Sentry Developer cron limit](https://www.sentry.help/en/articles/13963931-how-do-i-can-i-get-more-crons-on-a-developer-plan), [Cronitor plans](https://cronitor.io/pricing).

## GitHub-only alternative

The owner selected GitHub to avoid another monitoring account. Run the daily backup workflow and a separate hourly scheduled watchdog, away from the top of the hour. The watchdog checks the latest verified completed backup's timestamp in private B2 storage and fails if it is missing, older than 24 hours, or cannot be checked. Do not equate a successful Actions run with a verified backup object. Keep watchdog storage credentials read-only and do not print backup contents or secrets.

Enable and test native Actions failure emails. Verify that the intended owner receives scheduled-workflow notifications: GitHub ties these to the workflow's actor/cron modifier and re-enabling user, rather than providing arbitrary recipient routing. Also permit manual execution of backup and watchdog workflows. Storage lookup requests consume B2 operation allowances and must stay within the accepted caps.

A separate workflow can detect a failed or missing backup while the watchdog continues running. Both still depend on GitHub: schedules can be delayed/dropped and public-repository schedules disable after 60 inactive days. If neither workflow runs, neither creates a failed run to trigger its email. Another GitHub repository does not remove the shared platform dependency. This distinction follows from the documented schedule and notification behavior; it is not a claim that these outages will occur.

Sources: [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [scheduled events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [workflow notifications](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs).

## Sentry trade-offs

Use Sentry's Crons capability with scheduled check-ins rather than relying on captured exceptions. Its [HTTP check-in integration](https://docs.sentry.io/product/monitors-and-alerts/monitors/crons/getting-started/http/) supports a shell job sending success after completion, with scheduled missed-run detection even when the job never starts; an application SDK is not required. Configure an email alert for the cron monitor's missed/failed events. A single daily backup job fits the free allowance. A separately monitored restore-validation job would require another monitor and therefore a paid Sentry plan; combining unrelated jobs into one success signal would hide which job stopped working.

Sentry's official support documents that monitors failing for a prolonged period can have their alerts silenced, with a separate Broken Cron Monitors notification. If selected, configure and verify both cron failure notifications and that muted-monitor notification; do not assume alerts continue indefinitely. See [muted cron monitors](https://www.sentry.help/en/articles/13963919-why-did-i-receive-an-x-of-your-cron-monitors-has-been-muted-email).

Do not expand the agreed telemetry scope merely by selecting Sentry. Session replay, task payload capture, and logging secrets are not authorized. Any additional error/performance instrumentation should respect the existing data-exclusion policy and the permanent Developer quotas.

## Recommendation

GitHub-only monitoring is selected for this personal, best-effort MVP, with its shared-scheduler blind spot explicitly accepted. If independence from GitHub scheduling is required later, Healthchecks.io is the focused default and leaves free capacity for restore drills or later scheduled jobs. Sentry is a valid alternative when one backup cron monitor is sufficient and consolidating operational tooling is preferred. Cronitor is another viable free option. None should be upgraded, supplied with a payment method, or configured with paid overages without the owner's approval.

Regardless of vendor, establish the expected schedule before relying on it, verify missed-run and failure email delivery, and acknowledge that a successful upload signal does not establish that the backup can be restored. Periodically exercise restore separately. Avoid active uptime probes that prevent the API or database from sleeping unless that operational trade-off is explicitly accepted.
