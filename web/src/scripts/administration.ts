import { Api, ContextChanged, needsLogin } from "../lib/api";
import { create, clone } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  SitePolicyChangeSchema,
  SiteSafetyPolicySchema,
  type AdminOverview,
  type GrowthState,
  type SiteSafetyPolicy,
  type SitePolicyChange,
  type SitePolicyReview,
  type AdminAccount,
  type EmailOperationsOverview,
  type EmailSuppression,
  type AdminAuditPage,
  EmailOperationsQuerySchema,
} from "../gen/life/v1/accounts_pb";
import type { ResourceAmounts } from "../gen/life/v1/households_pb";
type Hooks = {
  show(): void;
  prepare(): Promise<boolean>;
  busy(value: boolean): void;
  expired(): void;
  sync(): void;
  confirm(
    title: string,
    description: string,
    accept: string,
    cancel: string,
    reference?: string,
  ): Promise<boolean>;
};
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "") {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
}
export class Administration {
  active = false;
  private overview?: AdminOverview;
  private policy?: SiteSafetyPolicy;
  private growth?: GrowthState;
  private email?: EmailOperationsOverview;
  private emailQuery = create(EmailOperationsQuerySchema);
  private audit?: AdminAuditPage;
  private recoveryReview = false;
  private draft?: SitePolicyChange;
  private review?: SitePolicyReview;
  private pending?: { run(): Promise<unknown>; message: string };
  private message = "";
  constructor(
    private root: HTMLElement,
    private api: Api,
    private hooks: Hooks,
  ) {}
  reset() {
    this.active = false;
    this.overview = undefined;
    this.policy = undefined;
    this.growth = undefined;
    this.email = undefined;
    this.emailQuery = create(EmailOperationsQuerySchema);
    this.audit = undefined;
    this.recoveryReview = false;
    this.draft = undefined;
    this.review = undefined;
    this.pending = undefined;
    this.message = "";
    this.root.replaceChildren();
  }
  dirty() {
    return !!this.draft;
  }
  hasPending() {
    return !!this.pending;
  }
  discardDraft() {
    this.draft = undefined;
    this.review = undefined;
  }
  async open(resume = false) {
    if (!this.api.isAdmin || (!resume && !(await this.hooks.prepare()))) return;
    this.hooks.busy(true);
    try {
      const [overview, policy, growth, email] = await Promise.all([
        this.api.administration.getOverview({}, { timeoutMs: 90000 }),
        this.api.administration.getPolicy({}, { timeoutMs: 90000 }),
        this.api.administration.getGrowth({}, { timeoutMs: 90000 }),
        this.api.administration.getEmailOperations(this.emailQuery, {
          timeoutMs: 90000,
        }),
      ]);
      this.overview = overview;
      this.policy = policy;
      this.growth = growth;
      this.email = email;
      this.active = true;
      this.hooks.show();
      if (this.draft) this.renderPolicy();
      else this.render();
    } catch (error) {
      if (error instanceof ContextChanged) return;
      if (needsLogin(error)) {
        this.hooks.expired();
        return;
      }
      this.active = true;
      this.hooks.show();
      this.root.replaceChildren(
        el("h1", "Admin overview"),
        el("p", "Administration is unavailable. Try again."),
      );
      this.root.append(this.button("Try again", () => void this.open(true)));
    } finally {
      this.hooks.busy(false);
    }
  }
  private button(label: string, click: () => void) {
    const b = el("button", label);
    b.type = "button";
    b.onclick = click;
    return b;
  }
  private async runPending() {
    if (!this.pending) return;
    this.hooks.busy(true);
    try {
      await this.pending.run();
      this.message = this.pending.message;
      this.pending = undefined;
      this.discardDraft();
      await this.open(true);
    } catch (error) {
      if (error instanceof ContextChanged) return;
      if (needsLogin(error)) {
        this.hooks.expired();
        return;
      }
      const definitive =
        error instanceof ConnectError &&
        [
          Code.InvalidArgument,
          Code.FailedPrecondition,
          Code.AlreadyExists,
          Code.PermissionDenied,
        ].includes(error.code);
      if (definitive) {
        this.pending = undefined;
        this.review = undefined;
      }
      this.message = definitive
        ? "The action was rejected. Refresh and review the latest settings before trying again."
        : "The result is uncertain. Retry the same action to confirm its saved state.";
      if (this.draft) this.renderPolicy();
      else this.render();
    } finally {
      this.hooks.busy(false);
    }
  }
  private async loadMoreOverview() {
    if (!this.overview || this.pending) return;
    this.hooks.busy(true);
    try {
      const page = await this.api.administration.getOverview(
        {
          afterAccount: this.overview.accounts.at(-1)?.id ?? "",
          afterHousehold: this.overview.households.at(-1)?.id ?? "",
        },
        { timeoutMs: 90000 },
      );
      const accounts = new Map(
        [...this.overview.accounts, ...page.accounts].map((a) => [a.id, a]),
      );
      const households = new Map(
        [...this.overview.households, ...page.households].map((h) => [h.id, h]),
      );
      this.overview = {
        ...page,
        accounts: [...accounts.values()],
        households: [...households.values()],
      };
      this.render();
    } catch (error) {
      if (error instanceof ContextChanged) return;
      if (needsLogin(error)) this.hooks.expired();
      else {
        this.message =
          "More metadata is unavailable. The records already loaded remain here; try again.";
        this.render();
      }
    } finally {
      this.hooks.busy(false);
    }
  }
  private async loadAudit(beforeSequence = 0n) {
    if (this.pending) return;
    this.hooks.busy(true);
    try {
      this.audit = await this.api.administration.listAudit(
        { beforeSequence },
        { timeoutMs: 90000 },
      );
      this.recoveryReview = false;
      this.render();
    } catch (error) {
      if (error instanceof ContextChanged) return;
      if (needsLogin(error)) this.hooks.expired();
      else {
        this.message = "Audit review is unavailable. Try again.";
        this.render();
      }
    } finally {
      this.hooks.busy(false);
    }
  }
  private backFromReview() {
    this.audit = undefined;
    this.recoveryReview = false;
    void this.open(true);
  }
  private renderAudit() {
    if (!this.audit) return;
    this.root.replaceChildren(
      el("h1", "Site audit"),
      el(
        "p",
        "Owner-only administrative events retained for one year. Private content and Google identifiers are not shown.",
      ),
    );
    for (const entry of this.audit.entries) {
      const card = el("article");
      card.className = "household-card";
      card.append(
        el("h2", entry.action),
        el(
          "p",
          `${entry.actorName} · ${new Date(Number(entry.occurredAt) * 1000).toLocaleString()}`,
        ),
      );
      this.root.append(card);
    }
    if (!this.audit.entries.length)
      this.root.append(el("p", "No admin events on this page."));
    if (this.audit.nextBefore)
      this.root.append(
        this.button(
          "Older audit events",
          () => void this.loadAudit(this.audit!.nextBefore),
        ),
      );
    this.root.append(
      this.button("Latest audit events", () => void this.loadAudit()),
      this.button("Back to admin overview", () => this.backFromReview()),
    );
    this.hooks.sync();
    this.root.querySelector("h1")?.setAttribute("tabindex", "-1");
    this.root.querySelector("h1")?.focus();
  }
  private renderRecovery() {
    if (!this.overview) return;
    this.root.replaceChildren(
      el("h1", "Recovery review"),
      el(
        "p",
        "Review metadata and independent protection before a restore. Restores run separately against an isolated database.",
      ),
      el(
        "p",
        `${this.overview.pendingSecurityChanges.toLocaleString()} pending security changes`,
      ),
      el(
        "p",
        `${this.overview.pendingClosures.toLocaleString()} pending closure protections`,
      ),
      el(
        "p",
        `${this.overview.pendingContentErasures.toLocaleString()} pending shared-content erasures`,
      ),
      el("p", this.growth?.paused ? "Growth is paused" : "Growth is open"),
      el(
        "p",
        "Restoration invalidates sign-in sessions, pending invitation links and queued mail. Later suspensions, removals and protected erasures must be replayed from the complete independent journal.",
      ),
      el(
        "p",
        "Backup freshness and provider storage size are unavailable here. Check both GitHub workflows and perform the isolated encrypted recovery drill before a restore.",
      ),
    );
    if (this.email?.accountingStatus === "recovery_hold")
      this.root.append(
        el(
          "p",
          "Email sending has a conservative recovery hold for the current UTC month. Resuming growth does not clear it.",
        ),
      );
    for (const [label, file] of [
      ["Check encrypted backups", "backup.yml"],
      ["Check backup age watchdog", "backup-watchdog.yml"],
    ]) {
      const p = el("p"),
        link = el("a", label);
      link.href = `https://github.com/intrepion/intrepion.com/actions/workflows/${file}`;
      p.append(link);
      this.root.append(p);
    }
    this.root.append(
      this.button("Back to admin overview", () => this.backFromReview()),
    );
    this.hooks.sync();
    this.root.querySelector("h1")?.setAttribute("tabindex", "-1");
    this.root.querySelector("h1")?.focus();
  }
  private feedback() {
    if (this.message) {
      const p = el("p", this.message);
      p.setAttribute("role", "status");
      this.root.append(p);
    }
    if (this.pending)
      this.root.append(
        this.button("Retry pending admin action", () => void this.runPending()),
      );
  }
  private async changeGrowth() {
    if (!this.growth || this.pending) return;
    const paused = !this.growth.paused,
      action = paused ? "Pause growth" : "Resume growth";
    if (
      !(await this.hooks.confirm(
        `${action}?`,
        paused
          ? "New invitations, queued email, resends and joining will pause. Existing accounts and lists remain available; invitations still expire."
          : "New invitations, queued email, resends and joining can resume under the current safety and email budgets.",
        action,
        "Keep current setting",
      ))
    )
      return;
    const request = {
      operationId: crypto.randomUUID(),
      expectedRevision: this.growth.revision,
      paused,
      confirmed: true,
    };
    this.pending = {
      run: () =>
        this.api.administration.changeGrowth(request, { timeoutMs: 90000 }),
      message: paused ? "Growth paused" : "Growth resumed",
    };
    await this.runPending();
  }
  private renderPolicy() {
    const draft = this.draft;
    if (!draft?.policy) return;
    this.root.replaceChildren(
      el(
        "h1",
        this.review ? "Review safety thresholds" : "Edit safety thresholds",
      ),
      el(
        "p",
        "Owner-only safety settings. Existing retained content and History are preserved; ordinary users do not see these numbers.",
      ),
    );
    this.feedback();
    const form = el("form");
    form.className = "safety-thresholds";
    for (const [name, amounts] of [
      ["Personal", draft.policy.personalSoft],
      ["Personal", draft.policy.personalHard],
      ["Household", draft.policy.householdSoft],
      ["Household", draft.policy.householdHard],
    ] as const) {
      const soft =
        amounts === draft.policy.personalSoft ||
        amounts === draft.policy.householdSoft;
      const fieldset = el("fieldset");
      fieldset.append(
        el("legend", `${name} ${soft ? "review" : "hard"} thresholds`),
      );
      for (const [key, label] of [
        ["items", "items"],
        ["shopping", "shopping lists"],
        ["templates", "checklist templates"],
        ["runs", "checklist runs"],
        ["bytes", "storage bytes"],
        ...(name === "Personal" ? [["households", "households"] as const] : []),
      ] as const) {
        const row = el(
          "label",
          `${name} ${label} ${soft ? "review" : "hard"} threshold`,
        );
        const input = el("input");
        input.type = "number";
        input.min = "1";
        input.max = "9007199254740991";
        input.step = "1";
        input.required = true;
        input.value = String(amounts?.[key] ?? 0n);
        input.disabled = !!this.review || !!this.pending;
        input.oninput = () => {
          if (amounts && /^\d+$/.test(input.value))
            amounts[key] = BigInt(input.value);
        };
        row.append(input);
        fieldset.append(row);
      }
      form.append(fieldset);
    }
    for (const [key, label] of [
      ["maxItemsPerCollection", "Items per collection hard threshold"],
      ["maxSectionsPerCollection", "Sections per collection hard threshold"],
    ] as const) {
      const row = el("label", label),
        input = el("input");
      input.type = "number";
      input.required = true;
      input.min = "1";
      input.max = "9007199254740991";
      input.step = "1";
      input.value = String(draft.policy[key]);
      input.disabled = !!this.review || !!this.pending;
      input.oninput = () => {
        if (/^\d+$/.test(input.value)) draft.policy![key] = BigInt(input.value);
      };
      row.append(input);
      form.append(row);
    }
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (this.pending) return;
      // Household counts are controlled per account; the shared policy schema
      // also requires positive household values for each household budget.
      if (
        draft.policy?.householdSoft &&
        draft.policy.personalSoft &&
        draft.policy.householdSoft.households === 0n
      )
        draft.policy.householdSoft.households =
          draft.policy.personalSoft.households;
      if (
        draft.policy?.householdHard &&
        draft.policy.personalHard &&
        draft.policy.householdHard.households === 0n
      )
        draft.policy.householdHard.households =
          draft.policy.personalHard.households;
      this.hooks.busy(true);
      try {
        this.review = await this.api.administration.previewPolicy(draft, {
          timeoutMs: 90000,
        });
        this.message = "";
        this.renderPolicy();
      } catch (error) {
        if (error instanceof ContextChanged) return;
        if (needsLogin(error)) this.hooks.expired();
        else {
          this.message =
            error instanceof ConnectError
              ? error.rawMessage
              : "Policy review is unavailable. Your draft remains here.";
          this.renderPolicy();
        }
      } finally {
        this.hooks.busy(false);
      }
    };
    if (!this.review) {
      const review = el("button", "Review threshold changes");
      review.type = "submit";
      review.disabled = !!this.pending;
      form.append(review);
    }
    this.root.append(form);
    if (this.review) {
      this.root.append(
        el("p", this.review.effect),
        el(
          "p",
          `Review covers ${this.review.accountCount} accounts and ${this.review.householdCount} retained households.`,
        ),
      );
      const apply = this.button(
        "Apply reviewed thresholds",
        () => void this.applyPolicy(),
      );
      apply.disabled = !!this.pending;
      this.root.append(apply);
      const edit = this.button("Edit reviewed thresholds", () => {
        this.review = undefined;
        this.renderPolicy();
      });
      edit.disabled = !!this.pending;
      this.root.append(edit);
    }
    const cancel = this.button("Cancel threshold edit", () => {
      this.discardDraft();
      this.message = "";
      this.render();
    });
    cancel.disabled = !!this.pending;
    this.root.append(cancel);
    this.hooks.sync();
  }
  private async applyPolicy() {
    if (!this.draft || !this.review || this.pending) return;
    if (
      !(await this.hooks.confirm(
        "Apply safety thresholds?",
        this.review.effect,
        "Apply thresholds",
        "Keep reviewing",
      ))
    )
      return;
    const request = create(SitePolicyChangeSchema, {
      ...this.draft,
      previewToken: this.review.previewToken,
      confirmed: true,
    });
    this.pending = {
      run: () =>
        this.api.administration.applyPolicy(request, { timeoutMs: 90000 }),
      message: "Safety thresholds saved",
    };
    await this.runPending();
  }
  private async changeAccess(account: AdminAccount) {
    if (account.siteOwner || this.pending) return;
    const action = account.suspended ? "Restore account" : "Suspend account";
    if (
      !(await this.hooks.confirm(
        `${action}?`,
        account.suspended
          ? "Allow this person to sign in again. Removed household memberships and revoked invitations stay removed; a fresh sign-in is required."
          : "End this person's current sign-ins and revoke their pending invitations. Personal data and household memberships are preserved.",
        action,
        account.suspended ? "Keep suspended" : "Keep access",
        account.displayName,
      ))
    )
      return;
    const request = {
      operationId: crypto.randomUUID(),
      accountId: account.id,
      expectedRevision: account.accessRevision,
      suspended: !account.suspended,
      confirmed: true,
    };
    this.pending = {
      run: () =>
        this.api.administration.setAccountAccess(request, { timeoutMs: 90000 }),
      message: account.suspended
        ? "Account access restored; a fresh sign-in is required."
        : "Account suspended; existing sign-ins have ended.",
    };
    await this.runPending();
  }
  private flags(
    usage: ResourceAmounts | undefined,
    threshold: ResourceAmounts | undefined,
    households = usage?.households ?? 0n,
  ) {
    if (!usage || !threshold) return "Usage review thresholds unavailable";
    const exceeded = (
      [
        ["items", "items"],
        ["shopping", "shopping lists"],
        ["templates", "checklist templates"],
        ["runs", "checklist runs"],
        ["bytes", "storage bytes"],
        ["households", "households"],
      ] as const
    )
      .filter(
        ([key]) =>
          threshold[key] > 0n &&
          (key === "households" ? households : usage[key]) >= threshold[key],
      )
      .map(([, label]) => label);
    return exceeded.length
      ? `Review recommended: ${exceeded.join(", ")}`
      : "Below current review thresholds";
  }
  private async clearSuppression(suppression: EmailSuppression) {
    if (this.pending) return;
    if (
      !(await this.hooks.confirm(
        "Clear email block?",
        "Confirm that you have reviewed and resolved the reported bounce or complaint. This permits future attempts, including any existing queued invitations.",
        "Clear reviewed block",
        "Keep blocked",
        suppression.recipientEmail,
      ))
    )
      return;
    const request = {
      operationId: crypto.randomUUID(),
      recipientEmail: suppression.recipientEmail,
      expectedRevision: suppression.revision,
      confirmed: true,
    };
    this.pending = {
      run: () =>
        this.api.administration.clearEmailSuppression(request, {
          timeoutMs: 90000,
        }),
      message: "Reviewed email block cleared",
    };
    await this.runPending();
  }
  private renderEmail() {
    if (!this.email) return;
    const email = this.email;
    const section = el("section");
    section.append(
      el("h2", "Email operations"),
      el(
        "p",
        email.accountingStatus === "recovery_hold"
          ? `Recovery counter floor: ${email.monthlyAttempts.toLocaleString()} / ${email.monthlyBudget.toLocaleString()}`
          : `${email.monthlyAttempts.toLocaleString()} / ${email.monthlyBudget.toLocaleString()} attempts this UTC month`,
      ),
      el(
        "p",
        "Attempts include uncertain provider responses. Submitted does not mean delivered. The application ceiling does not cap all AWS invoice charges.",
      ),
    );
    if (email.accountingStatus === "recovery_hold")
      section.append(
        el(
          "p",
          "Email sending is held for recovery review because the backup may omit later attempts. Existing accounts remain available. The next UTC month starts a new allowance; resuming growth does not clear this sending hold.",
        ),
      );
    if (email.warning) {
      const warning = el(
        "p",
        "Email attempt budget needs review (80% or more used).",
      );
      warning.setAttribute("role", "status");
      section.append(warning);
    }
    const form = el("form"),
      label = el("label", "Find delivery by recipient email"),
      input = el("input");
    input.type = "email";
    input.value = this.emailQuery.recipientEmail;
    label.append(input);
    const search = el("button", "Find recipient");
    search.type = "submit";
    search.disabled = !!this.pending;
    form.append(label, search);
    form.onsubmit = (event) => {
      event.preventDefault();
      this.emailQuery = create(EmailOperationsQuerySchema, {
        recipientEmail: input.value.trim(),
      });
      void this.open(true);
    };
    section.append(form, el("h3", "Delivery attempts retained for 30 days"));
    if (!email.deliveries.length)
      section.append(el("p", "No delivery attempts on this page."));
    for (const delivery of email.deliveries)
      section.append(
        el(
          "p",
          `${delivery.recipientEmail} · ${delivery.outcome} · ${new Date(Number(delivery.attemptedAt) * 1000).toLocaleString()}`,
        ),
      );
    if (email.nextDeliveryId)
      section.append(
        this.button("Older delivery attempts", () => {
          this.emailQuery.beforeId = email.nextDeliveryId;
          this.emailQuery.beforeTime = email.nextDeliveryTime;
          void this.open(true);
        }),
      );
    section.append(
      el("h3", "Current email blocks"),
      el(
        "p",
        "Reported permanent bounces and complaints prevent sending. Blocks remain after delivery-log expiry; some providers do not report complaints.",
      ),
    );
    if (!email.suppressions.length)
      section.append(el("p", "No email blocks on this page."));
    for (const suppression of email.suppressions) {
      const card = el("article");
      card.className = "household-card";
      card.append(
        el("h4", suppression.recipientEmail),
        el(
          "p",
          suppression.reason === "hard_bounce"
            ? "Reported permanent bounce"
            : "Reported complaint",
        ),
      );
      const clear = this.button(
        "Review and clear email block",
        () => void this.clearSuppression(suppression),
      );
      clear.disabled = !!this.pending;
      card.append(clear);
      section.append(card);
    }
    if (email.nextSuppression)
      section.append(
        this.button("More email blocks", () => {
          this.emailQuery.afterSuppression = email.nextSuppression;
          void this.open(true);
        }),
      );
    section.append(
      this.button("Reset email filters and pages", () => {
        this.emailQuery = create(EmailOperationsQuerySchema);
        void this.open(true);
      }),
    );
    this.root.append(section);
  }
  private render() {
    if (!this.overview) return;
    if (this.audit) {
      this.renderAudit();
      return;
    }
    if (this.recoveryReview) {
      this.renderRecovery();
      return;
    }
    const overview = this.overview;
    this.root.replaceChildren(
      el("h1", "Admin overview"),
      el("p", "Site owner only · Metadata and operational controls"),
    );
    this.feedback();
    const audit = this.button("Site audit", () => void this.loadAudit());
    audit.disabled = !!this.pending;
    const recovery = this.button("Recovery review", () => {
      this.recoveryReview = true;
      this.render();
    });
    recovery.disabled = !!this.pending;
    this.root.append(audit, recovery);
    if (this.growth) {
      const section = el("section");
      section.append(
        el("h2", "Growth controls"),
        el("p", this.growth.paused ? "Growth is paused" : "Growth is open"),
      );
      const toggle = this.button(
        this.growth.paused ? "Resume growth" : "Pause growth",
        () => void this.changeGrowth(),
      );
      toggle.disabled = !!this.pending;
      section.append(toggle);
      this.root.append(section);
    }
    if (this.policy) {
      const edit = this.button("Edit safety thresholds", () => {
        if (!this.policy || this.pending) return;
        this.draft = create(SitePolicyChangeSchema, {
          operationId: crypto.randomUUID(),
          expectedRevision: this.policy.revision,
          policy: {
            ...clone(SiteSafetyPolicySchema, this.policy),
            enabled: true,
          },
        });
        this.review = undefined;
        this.message = "";
        this.renderPolicy();
      });
      edit.disabled = !!this.pending;
      this.root.append(edit);
    }
    const grid = el("div");
    grid.className = "admin-grid";
    for (const [title, value, note] of [
      [
        "Accounts",
        `${overview.accountCount.toLocaleString()} accounts`,
        `${overview.suspendedAccountCount.toLocaleString()} suspended`,
      ],
      [
        "Households",
        `${overview.activeHouseholdCount.toLocaleString()} active`,
        `${overview.closedHouseholdCount.toLocaleString()} closed and retained`,
      ],
      [
        "Logical retained storage",
        `${overview.logicalBytes.toLocaleString()} B`,
        this.policy?.enabled
          ? "Content, History and household metadata payloads; excludes site-wide operations, identifiers and physical/index overhead"
          : "Legacy content and content History accounting; independent metadata budgets are not active",
      ],
      [
        "Provider daily usage",
        "Unavailable",
        "Dashboard review required; this is not a measured zero",
      ],
      [
        "Retained usage change",
        overview.growthStatus === "measured"
          ? `${overview.logicalByteChange.toLocaleString()} B`
          : "Not enough history",
        overview.growthStatus === "measured"
          ? `Since ${new Date(Number(overview.growthSince) * 1000).toLocaleString()} · ${overview.accountChange.toLocaleString()} accounts · ${overview.householdChange.toLocaleString()} households`
          : "Daily anonymous samples need a comparable window at least one day old. Samples from before the accounting transition are not compared.",
      ],
    ]) {
      const card = el("article");
      card.className = "household-card";
      card.append(el("h2", title), el("strong", value), el("p", note));
      grid.append(card);
    }
    this.root.append(
      grid,
      this.button("Refresh overview", () => void this.open(true)),
      el("h2", "Account review"),
    );
    for (const account of overview.accounts) {
      const card = el("article");
      card.className = "household-card";
      card.append(
        el("h3", account.displayName),
        el(
          "p",
          `${account.suspended ? "Suspended" : "Active"} · ${account.personalUsage?.bytes.toLocaleString() ?? "0"} B personal retained content · ${account.activeHouseholds.toLocaleString()} active households`,
        ),
        el("p", "Private task and recipe contents are not shown."),
        el("p", this.flags(account.personalUsage, this.policy?.personalSoft)),
      );
      if (account.siteOwner)
        card.append(el("p", "Site owner · Access retained"));
      else {
        const access = this.button(
          account.suspended ? "Restore account" : "Suspend account",
          () => void this.changeAccess(account),
        );
        access.disabled = !!this.pending;
        card.append(access);
      }
      if (account.protectionPending)
        card.append(
          el(
            "p",
            "Independent access protection is pending. Retry the same pending action before further access changes.",
          ),
        );
      this.root.append(card);
    }
    this.root.append(el("h2", "Household review"));
    for (const household of overview.households) {
      const card = el("article");
      card.className = "household-card";
      card.append(
        el("h3", household.name),
        el(
          "p",
          `${household.status} · ${household.activeHeads.toLocaleString()} heads · ${household.usage?.bytes.toLocaleString() ?? "0"} B retained content`,
        ),
        el("p", this.flags(household.usage, this.policy?.householdSoft)),
      );
      this.root.append(card);
    }
    this.renderEmail();
    if (overview.nextAccount || overview.nextHousehold) {
      const more = this.button(
        "Load more accounts and households",
        () => void this.loadMoreOverview(),
      );
      more.disabled = !!this.pending;
      this.root.append(more);
    }
    this.root.append(
      el(
        "p",
        `Loaded ${overview.accounts.length} accounts and ${overview.households.length} retained households. Totals cover the whole site; metadata may change while pages load.`,
      ),
    );
    this.hooks.sync();
  }
}
