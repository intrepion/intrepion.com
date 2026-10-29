# Consent-based invitation prototype

The owner approved the prototype. It settled the invitation-request and notification flows described in the [approved scope](../../docs/mvp-3-1-consent-plan.md). The throwaway source is preserved on branch `prototype/consent-invitations`.

The prototype is preserved on the separate `prototype/consent-invitations` branch. To open a copy without switching branches, run these commands from the repository root:

```sh
git show prototype/consent-invitations:prototype/public/consent-invitations/index.html > /tmp/intrepion-consent-prototype.html
xdg-open /tmp/intrepion-consent-prototype.html
```

It runs directly in the browser without the web server or other dependencies. Everything is simulated: Google sign-in, the household link, copying the link, email delivery, and the clock. It does not copy to the clipboard, send email, contact a provider, or save state; reloading resets it. The review-only state panel shows synthetic information and is not a proposed production screen.

Select a guided walkthrough and use its next-step button. Walkthroughs switch between the simulated head and requester automatically. In free play, choose the person yourself and use the available actions. The 15 walkthroughs cover:

- Invite Jordan; duplicate requests; link revocation; withdrawal.
- Sending allowance; pause and recovery; wrong account; link expiration.
- Decline and retry; the 30-day consent window; suppressed notifications; uncertain delivery.
- 30-day data removal; competing decisions; notification address changes.

The prototype uses one synthetic household and requester. Competing decisions are simulated sequentially; this is not a concurrency test. Data removal, provider delivery, and recovery are illustrations, not evidence that production deletion, mail delivery, or backup handling works. Production code will be implemented separately after prototype approval.

Local browser checks exercised all 15 walkthroughs, verified the pre-sign-in privacy screen and absence of external requests, and checked desktop and mobile widths of 1440, 390, and 320 pixels.
