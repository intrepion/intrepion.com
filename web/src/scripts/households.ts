import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  HouseholdAction,
  HouseholdChangeSchema,
  type HouseholdDetails,
  type HouseholdSummary,
  type InvitationPreview,
  type HouseholdChange,
  type AccountOverview,
  type HouseholdActivityEntry,
  ResourceAmountsSchema,
  CopyRequestSchema,
  type CopyRequest,
} from "../gen/life/v1/households_pb";
import type { Collection } from "../gen/life/v1/lists_pb";
import { Api, needsLogin, ContextChanged } from "../lib/api";

type Hooks = {
  show(): void;
  prepare(): Promise<boolean>;
  clearContent(): void;
  switchSpace(id: string): Promise<boolean>;
  enterSpace(id: string): Promise<void>;
  openCopy(space: string, id: string): Promise<void>;
  invitationArrived(): Promise<void>;
  busy(value: boolean): void;
  syncBusyControls(): void;
  expired(): void;
  confirm(
    title: string,
    description: string,
    accept: string,
    cancel: string,
    reference?: string,
  ): Promise<boolean>;
};
const resources = [
  ["items", "Items"],
  ["shopping", "Shopping lists"],
  ["templates", "Templates"],
  ["runs", "Runs"],
  ["bytes", "Storage bytes"],
] as const;
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
function button(text: string, run: () => void) {
  const node = element("button", text);
  node.type = "button";
  node.addEventListener("click", run);
  return node;
}
export class Households {
  active = false;
  private overview?: AccountOverview;
  private details?: HouseholdDetails;
  private activity: HouseholdActivityEntry[] = [];
  private activityCursor = 0n;
  private invitationToken = "";
  private deliveredLink = "";
  private closureRetries = new Map<string, HouseholdChange>();
  private pending?: HouseholdChange;
  private pendingCopy?: CopyRequest;
  private message = "";
  private capacityMode: "capacity" | "households" = "capacity";
  constructor(
    private root: HTMLElement,
    private toolbar: HTMLElement,
    private api: Api,
    private hooks: Hooks,
  ) {
    this.captureInvitation();
    window.addEventListener("hashchange", () => {
      if (this.captureInvitation()) void this.hooks.invitationArrived();
    });
  }
  private captureInvitation() {
    const token = new URLSearchParams(location.hash.slice(1)).get("invite");
    if (!token) return false;
    history.replaceState(null, "", location.pathname + location.search);
    if (!/^[0-9a-f]{64}$/.test(token)) return false;
    this.invitationToken = token;
    return true;
  }
  reset() {
    this.active = false;
    this.overview = undefined;
    this.details = undefined;
    this.activity = [];
    this.activityCursor = 0n;
    this.deliveredLink = "";
    this.closureRetries.clear();
    this.pending = undefined;
    this.pendingCopy = undefined;
    this.message = "";
    this.capacityMode = "capacity";
    this.root.replaceChildren();
    this.toolbar.replaceChildren();
  }
  hasPending() {
    return !!this.pending || !!this.pendingCopy;
  }
  dirty() {
    return (
      this.active &&
      Array.from(
        this.root.querySelectorAll<HTMLInputElement>("input:not([readonly])"),
      ).some((input) => input.value !== input.defaultValue)
    );
  }
  discardDraft() {
    this.root.replaceChildren();
    this.active = false;
  }
  resume() {
    this.hooks.show();
    if (!this.root.childElementCount) this.renderCapacity();
  }
  async refresh() {
    this.overview = await this.api.households.getOverview(
      {},
      { timeoutMs: 90000 },
    );
    if (
      this.api.space !== "personal" &&
      !this.overview.households.some(
        (h) => h.id === this.api.space && h.isHead && h.status === "active",
      )
    ) {
      this.api.space = "personal";
      this.hooks.clearContent();
      this.discardDraft();
      this.details = undefined;
      this.message =
        "Household access ended. Your personal space is open; retained allocations are in My capacity.";
    }
    this.renderToolbar();
  }
  private renderToolbar() {
    if (!this.overview) return;
    const label = element("label", "Space");
    const select = element("select");
    select.id = "space-selector";
    label.htmlFor = select.id;
    select.append(new Option("Personal · Private", "personal"));
    for (const h of this.overview.households.filter(
      (h) => h.isHead && h.status === "active",
    ))
      select.append(new Option(`${h.name} · Shared · Head`, h.id));
    select.value = this.api.space;
    this.api.spaceLabel =
      select.selectedOptions[0]?.textContent ?? "Personal · Private";
    select.addEventListener("change", () => {
      const target = select.value;
      select.value = this.api.space;
      this.api.spaceLabel =
        select.selectedOptions[0]?.textContent ?? "Personal · Private";
      void this.hooks.switchSpace(target);
    });
    const capacity = button("My capacity", () => void this.openCapacity());
    const households = button(
      "Households",
      () => void this.openCapacity("households"),
    );
    this.toolbar.replaceChildren(label, select, households, capacity);
    if (this.api.space !== "personal")
      this.toolbar.append(button("Household", () => void this.openHousehold()));
    this.hooks.syncBusyControls();
  }
  async openCapacity(mode: "capacity" | "households" = "capacity") {
    if (!(await this.hooks.prepare())) return;
    this.hooks.busy(true);
    try {
      await this.refresh();
      this.capacityMode = mode;
      this.renderCapacity();
    } catch (error) {
      this.problem(error);
    } finally {
      this.hooks.busy(false);
    }
  }
  private problem(error: unknown) {
    if (error instanceof ContextChanged) return;
    if (needsLogin(error)) {
      this.hooks.expired();
      return;
    }
    this.message =
      error instanceof ConnectError
        ? error.rawMessage
        : "This action could not be confirmed. Retry the same action.";
    const feedback = element("p", this.message);
    feedback.className = "error";
    feedback.setAttribute("role", "alert");
    this.root.prepend(feedback);
  }
  private renderCapacity() {
    if (!this.overview) return;
    this.hooks.show();
    if (this.capacityMode === "households") {
      this.root.replaceChildren(element("h1", "Households"));
      if (this.message) this.root.append(element("p", this.message));
      this.root.append(
        element(
          "p",
          "Create a shared space or manage one you head. Your personal content stays private.",
        ),
        button("Create household", () => this.createForm()),
        button("View my capacity", () => void this.openCapacity()),
        button(
          "Refresh households",
          () => void this.openCapacity("households"),
        ),
      );
      if (this.overview.households.length === 0)
        this.root.append(
          element("p", "No households yet. Create your first shared space."),
        );
      this.renderHouseholdCards();
      return;
    }
    this.root.replaceChildren(element("h1", "My capacity"));
    if (this.message) this.root.append(element("p", this.message));
    this.root.append(
      element(
        "p",
        "Your pilot plan is private. Allocations reserve capacity for a household; contributing more does not grant more authority.",
      ),
    );
    if (!this.overview.planConfigured)
      this.root.append(
        element(
          "p",
          "The operator must configure your finite pilot plan before you can add content.",
        ),
      );
    const identityLabel = element("label", "Your account ID");
    identityLabel.htmlFor = "pilot-public-id";
    const identity = element("input");
    identity.id = identityLabel.htmlFor;
    identity.readOnly = true;
    identity.value = this.overview.identity?.id ?? "";
    this.root.append(
      identityLabel,
      identity,
      element(
        "p",
        "Share this ID with an existing head to receive a recipient-bound invitation.",
      ),
    );
    const list = element("dl");
    for (const [key, label] of resources) {
      list.append(
        element("dt", label),
        element(
          "dd",
          `Personal usage ${this.overview.personalUsage?.[key].toLocaleString() ?? "0"} / ${this.overview.personalCapacity?.[key].toLocaleString() ?? "0"} · Plan ${this.overview.plan?.[key].toLocaleString() ?? "0"}`,
        ),
      );
    }
    list.append(
      element("dt", "Households headed"),
      element(
        "dd",
        `${this.overview.personalUsage?.households ?? 0n} / ${this.overview.plan?.households ?? 0n}`,
      ),
    );
    this.root.append(
      list,
      button("Create household", () => this.createForm()),
      button("Refresh capacity", () => void this.openCapacity()),
    );
    this.renderHouseholdCards();
  }
  private renderHouseholdCards() {
    if (!this.overview) return;
    for (const h of this.overview.households) {
      const card = element("article");
      card.className = "household-card";
      card.append(
        element("h2", h.name),
        element("p", `${h.status}${h.isHead ? " · Head" : ""}`),
      );
      if (h.isHead && h.status === "active")
        card.append(
          button(
            `Manage household ${h.name}`,
            () => void this.manageHousehold(h.id),
          ),
        );
      if (h.ownContribution)
        card.append(
          element(
            "p",
            resources
              .map(
                ([key, label]) =>
                  `${label}: ${h.ownContribution![key].toLocaleString()}`,
              )
              .join(" · "),
          ),
        );
      if (h.ownContribution && h.status === "active")
        card.append(
          button(`Manage my allocation for ${h.name}`, () =>
            this.allocationForm(h),
          ),
        );
      if (h.status === "closed" || h.status === "erasing")
        card.append(
          element(
            "p",
            `Closure is final. Capacity remains reserved until protected erasure succeeds. Deadline: ${new Date(Number(h.eraseDueAt) * 1000).toISOString()} UTC (${new Date(Number(h.eraseDueAt) * 1000).toLocaleString()} local).${h.erasureDelayed ? " Erasure delayed; the operator must retry." : ""}`,
          ),
        );
      if (h.closureProtectionPending) {
        card.append(
          element(
            "p",
            "Closure recovery protection pending. Access has ended; capacity stays reserved. Operator maintenance will retry protection.",
          ),
        );
        const retry = this.closureRetries.get(h.id);
        if (retry)
          card.append(
            button(
              `Retry closure protection for ${h.name}`,
              () =>
                void this.change(retry, async () => {
                  this.closureRetries.delete(h.id);
                  this.message = "Closure recovery protection is confirmed.";
                  this.renderCapacity();
                }),
            ),
          );
      }
      this.root.append(card);
    }
  }
  private async manageHousehold(id: string) {
    try {
      if (await this.hooks.switchSpace(id)) {
        if (this.api.space === id) await this.openHousehold();
      }
    } catch (error) {
      this.problem(error);
    }
  }
  private allocationForm(household: HouseholdSummary) {
    this.root.replaceChildren(
      element("h1", `My allocation · ${household.name}`),
    );
    this.root.append(
      element(
        "p",
        household.isHead
          ? "Change only your own contribution. Your personal remainder and retained household usage must still fit."
          : "Your content access has ended. You may retain or withdraw your own allocation when eligible. Shared totals and content are unavailable.",
      ),
    );
    const form = element("form");
    form.className = "editor";
    const inputs = new Map<string, HTMLInputElement>();
    for (const [key, label] of resources) {
      const input = element("input");
      input.id = `allocation-${key}`;
      input.inputMode = "numeric";
      input.pattern = "[0-9]+";
      input.required = true;
      input.defaultValue = String(household.ownContribution?.[key] ?? 0n);
      input.value = input.defaultValue;
      const fieldLabel = element("label", `${label} allocated`);
      fieldLabel.htmlFor = input.id;
      inputs.set(key, input);
      form.append(fieldLabel, input);
    }
    const submit = element("button", "Preview allocation");
    submit.type = "submit";
    form.append(
      submit,
      button("Back to my capacity", () => void this.openCapacity()),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.previewAllocation(household, inputs);
    });
    this.root.append(form);
  }
  private async previewAllocation(
    household: HouseholdSummary,
    inputs: Map<string, HTMLInputElement>,
  ) {
    const requested = create(ResourceAmountsSchema);
    for (const [key] of resources) {
      const raw = inputs.get(key)!.value;
      if (!/^[0-9]+$/.test(raw) || BigInt(raw) > 9007199254740991n) {
        this.problem(
          new ConnectError(
            "Enter non-negative safe whole amounts.",
            Code.InvalidArgument,
          ),
        );
        return;
      }
      requested[key] = BigInt(raw);
    }
    this.hooks.busy(true);
    try {
      const preview = await this.api.households.previewAllocation(
        { householdId: household.id, amounts: requested },
        { timeoutMs: 90000 },
      );
      if (!preview.allowed) {
        this.problem(new ConnectError(preview.reason, Code.FailedPrecondition));
        return;
      }
      const changes = resources
        .map(
          ([key, label]) =>
            `${label}: ${preview.current?.[key].toLocaleString() ?? "0"} → ${requested[key].toLocaleString()}; personal remainder ${preview.personalBefore?.[key].toLocaleString() ?? "0"} → ${preview.personalAfter?.[key].toLocaleString() ?? "0"}`,
        )
        .join(". ");
      // Confirmation remains interactive while no write is in flight.
      this.hooks.busy(false);
      if (
        !(await this.hooks.confirm(
          "Apply this allocation?",
          `${changes}. Reserved capacity cannot also be used personally or in another household.`,
          "Apply allocation",
          "Keep editing",
          household.name,
        ))
      )
        return;
      await this.change(
        create(HouseholdChangeSchema, {
          operationId: crypto.randomUUID(),
          householdId: household.id,
          expectedRevision: household.revision,
          action: HouseholdAction.ALLOCATE,
          amounts: requested,
        }),
        async () => {
          this.message = "Your allocation was updated.";
          this.renderCapacity();
        },
      );
    } catch (error) {
      this.problem(error);
    } finally {
      this.hooks.busy(false);
    }
  }
  private createForm() {
    this.root.replaceChildren(element("h1", "Create household"));
    const form = element("form");
    form.className = "editor";
    const name = element("input");
    name.id = "household-name";
    name.maxLength = 100;
    name.required = true;
    const nameLabel = element("label", "Household name");
    nameLabel.htmlFor = name.id;
    form.append(nameLabel, name);
    const inputs = new Map<string, HTMLInputElement>();
    for (const [key, label] of resources) {
      const input = element("input");
      input.id = `allocate-${key}`;
      const capacity = this.overview?.personalCapacity?.[key] ?? 0n;
      const usage = this.overview?.personalUsage?.[key] ?? 0n;
      const maximum = capacity > usage ? capacity - usage : 0n;
      input.type = "number";
      input.min = "0";
      input.max = String(maximum);
      input.step = "1";
      input.inputMode = "numeric";
      input.required = true;
      input.defaultValue = String(maximum / 2n);
      input.value = input.defaultValue;
      const fieldLabel = element("label", `${label} to allocate`);
      fieldLabel.htmlFor = input.id;
      const slider = element("input");
      slider.type = "range";
      slider.id = `allocate-${key}-slider`;
      slider.min = "0";
      slider.max = input.max;
      slider.step = "1";
      slider.defaultValue = input.defaultValue;
      slider.value = slider.defaultValue;
      slider.setAttribute("aria-label", `${label} allocation slider`);
      const available = element("p", `${maximum.toLocaleString()} available`);
      available.id = `allocate-${key}-available`;
      available.className = "allocation-available";
      input.setAttribute("aria-describedby", available.id);
      slider.setAttribute("aria-describedby", available.id);
      slider.disabled = maximum === 0n;
      slider.addEventListener("input", () => {
        input.value = slider.value;
      });
      input.addEventListener("input", () => {
        if (input.validity.valid && input.value !== "")
          slider.value = input.value;
      });
      inputs.set(key, input);
      const controls = element("div");
      controls.className = "allocation-controls";
      controls.append(slider, input);
      form.append(fieldLabel, controls, available);
    }
    form.append(
      element(
        "p",
        "Defaults are half the available capacity, rounded down. Drag each slider or enter an exact amount. Existing personal usage and household allocations reduce what is available. The name consumes UTF-8 storage. Your existing personal content stays private.",
      ),
    );
    const submit = element("button", "Review household");
    submit.type = "submit";
    form.append(
      submit,
      button("Cancel", () => this.renderCapacity()),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.createHousehold(name.value, inputs, submit);
    });
    this.root.append(form);
    name.focus();
  }
  private async createHousehold(
    name: string,
    inputs: Map<string, HTMLInputElement>,
    submit: HTMLButtonElement,
  ) {
    try {
      if (!this.pending) {
        const amounts = create(ResourceAmountsSchema);
        for (const [key] of resources) {
          const raw = inputs.get(key)!.value;
          if (!/^[0-9]+$/.test(raw) || BigInt(raw) > 9007199254740991n)
            throw new Error("Enter non-negative safe whole amounts.");
          amounts[key] = BigInt(raw);
        }
        const reference = `${name.trim()} · ${resources.map(([key, label]) => `${label}: ${amounts[key]}`).join(" · ")}`;
        if (
          !(await this.hooks.confirm(
            "Create this household?",
            "These allocations stop being available personally. Personal content is not copied. Everyone who joins as a head has equal authority.",
            "Create household",
            "Keep editing",
            reference,
          ))
        )
          return;
        this.pending = create(HouseholdChangeSchema, {
          operationId: crypto.randomUUID(),
          householdId: crypto.randomUUID(),
          action: HouseholdAction.CREATE,
          name,
          amounts,
        });
      }
      this.hooks.busy(true);
      await this.api.households.changeHousehold(this.pending, {
        timeoutMs: 90000,
      });
      this.pending = undefined;
      this.message = "Household created. Personal content remains private.";
      await this.refresh();
      this.renderCapacity();
    } catch (error) {
      if (
        error instanceof ConnectError &&
        [
          Code.InvalidArgument,
          Code.FailedPrecondition,
          Code.ResourceExhausted,
        ].includes(error.code)
      )
        this.pending = undefined;
      for (const input of this.root.querySelectorAll<HTMLInputElement>(
        "input:not([readonly])",
      ))
        input.readOnly = !!this.pending;
      this.problem(error);
      submit.textContent = this.pending
        ? "Retry household creation"
        : "Review household";
    } finally {
      this.hooks.busy(false);
    }
  }
  async startCopy(source: Collection) {
    if (this.api.space !== "personal" || !(await this.hooks.prepare())) return;
    this.hooks.busy(true);
    try {
      await this.refresh();
      this.hooks.show();
      this.root.replaceChildren(
        element("h1", "Copy to household"),
        element(
          "p",
          `Source: ${source.title} · Personal · Private. The original stays private. The destination receives an independent current snapshot with fresh History; previous private History and Trash are not copied.`,
        ),
      );
      const label = element("label", "Destination household");
      label.htmlFor = "copy-destination";
      const select = element("select");
      select.id = label.htmlFor;
      select.append(new Option("Choose a household", ""));
      for (const h of this.overview?.households.filter(
        (h) => h.isHead && h.status === "active",
      ) ?? [])
        select.append(new Option(h.name, h.id));
      const preview = button(
        "Preview independent copy",
        () => void this.previewCopy(source, select),
      );
      this.root.append(label, select, preview);
    } catch (error) {
      this.problem(error);
    } finally {
      this.hooks.busy(false);
    }
  }
  private async previewCopy(source: Collection, select: HTMLSelectElement) {
    if (!select.value || this.pendingCopy) return;
    const destination = select.value;
    const name = select.selectedOptions[0]?.textContent ?? "Household";
    const request = create(CopyRequestSchema, {
      operationId: crypto.randomUUID(),
      sourceCollectionId: source.id,
      expectedSourceRevision: source.revision,
      householdId: destination,
      destinationCollectionId: crypto.randomUUID(),
    });
    this.hooks.busy(true);
    try {
      const preview = await this.api.households.previewCopy(request, {
        timeoutMs: 90000,
      });
      if (!preview.allowed) {
        this.problem(new ConnectError(preview.reason, Code.ResourceExhausted));
        return;
      }
      const required = resources
        .map(
          ([key, label]) =>
            `${label}: ${preview.required?.[key].toLocaleString() ?? "0"}`,
        )
        .join(". ");
      this.hooks.busy(false);
      if (
        !(await this.hooks.confirm(
          "Create this independent copy?",
          `${required}. Current destination usage and your own ceilings are rechecked when saving. Either the whole copy is saved or nothing is added. The original and its previous History stay private.`,
          "Create independent copy",
          "Cancel",
          `${source.title} · Personal → ${name} · Shared`,
        ))
      )
        return;
      await this.saveCopy(request, name);
    } catch (error) {
      this.problem(error);
    } finally {
      this.hooks.busy(false);
    }
  }
  private async saveCopy(request: CopyRequest, name: string) {
    this.pendingCopy = request;
    this.hooks.busy(true);
    try {
      const result = await this.api.households.copyCollection(request, {
        timeoutMs: 90000,
      });
      if (!result.collection) throw new Error("Missing copy acknowledgment.");
      this.pendingCopy = undefined;
      await this.hooks.openCopy(request.householdId, result.collection.id);
    } catch (error) {
      if (
        error instanceof ConnectError &&
        [
          Code.InvalidArgument,
          Code.FailedPrecondition,
          Code.ResourceExhausted,
          Code.PermissionDenied,
          Code.NotFound,
        ].includes(error.code)
      )
        this.pendingCopy = undefined;
      this.problem(error);
      if (this.pendingCopy)
        this.root.append(
          button(
            `Retry copy to ${name}`,
            () => void this.saveCopy(request, name),
          ),
        );
    } finally {
      this.hooks.busy(false);
      if (this.pendingCopy)
        for (const control of this.root.querySelectorAll<
          HTMLSelectElement | HTMLButtonElement
        >("select,button")) {
          if (
            control instanceof HTMLSelectElement ||
            control.textContent === "Preview independent copy"
          )
            control.disabled = true;
        }
    }
  }
  hasInvitation() {
    return !!this.invitationToken;
  }
  async openInvitation() {
    this.hooks.show();
    this.root.replaceChildren(element("h1", "Head invitation"));
    try {
      const invitation = await this.api.households.getInvitation(
        { token: this.invitationToken },
        { timeoutMs: 90000 },
      );
      this.renderInvitation(invitation);
    } catch (error) {
      this.problem(error);
    }
  }
  private renderInvitation(invitation: InvitationPreview) {
    this.root.replaceChildren(
      element("h1", "Head invitation"),
      element("h2", invitation.householdName),
      element(
        "p",
        `Invitation status: ${invitation.status}. Signed in as ${this.api.displayName}.`,
      ),
    );
    if (
      invitation.status === "pending" ||
      this.pending?.action === HouseholdAction.ACCEPT_INVITATION
    ) {
      this.root.append(
        element(
          "p",
          "Joining grants equal head authority and access to all existing household History. It does not automatically contribute your personal capacity.",
        ),
        button(
          this.pending
            ? "Retry accepting membership"
            : "Accept head membership",
          () => void this.acceptInvitation(invitation),
        ),
      );
    }
    this.root.append(
      button("Dismiss invitation", () => {
        if (this.pending) return;
        this.invitationToken = "";
        void this.hooks.enterSpace("personal");
      }),
    );
  }
  private async acceptInvitation(invitation: InvitationPreview) {
    if (
      !this.pending &&
      !(await this.hooks.confirm(
        "Join as a head?",
        "You will have the same authority as every other head and can see all household History. Your private plan and personal content stay private.",
        "Join household",
        "Cancel",
        invitation.householdName,
      ))
    )
      return;
    const request =
      this.pending ??
      create(HouseholdChangeSchema, {
        operationId: crypto.randomUUID(),
        householdId: invitation.householdId,
        action: HouseholdAction.ACCEPT_INVITATION,
        invitationToken: this.invitationToken,
      });
    await this.change(request, async () => {
      this.invitationToken = "";
      await this.hooks.enterSpace(invitation.householdId);
    });
  }
  async openHousehold() {
    if (!(await this.hooks.prepare())) return;
    this.hooks.busy(true);
    try {
      await this.reloadHousehold();
    } catch (error) {
      this.problem(error);
    } finally {
      this.hooks.busy(false);
    }
  }
  private async reloadHousehold() {
    this.details = await this.api.households.getHousehold(
      { id: this.api.space },
      { timeoutMs: 90000 },
    );
    const page = await this.api.households.listHouseholdActivity(
      { householdId: this.api.space },
      { timeoutMs: 90000 },
    );
    this.activity = page.entries;
    this.activityCursor = page.nextBeforeSequence;
    this.renderHousehold();
  }
  private renderHousehold() {
    if (!this.details?.household) return;
    const detail = this.details;
    const household = detail.household!;
    this.hooks.show();
    this.root.replaceChildren(
      element("h1", household.name),
      element(
        "p",
        "Shared household · Head. Authority is equal regardless of contribution. Personal plans are private.",
      ),
    );
    if (this.message) this.root.append(element("p", this.message));
    this.root.append(
      button("Refresh household", () => void this.openHousehold()),
      button("Invite approved head", () => this.inviteForm()),
    );
    const usage = element("dl");
    for (const [key, label] of resources)
      usage.append(
        element("dt", label),
        element(
          "dd",
          `${detail.usage?.[key].toLocaleString() ?? "0"} / ${detail.capacity?.[key].toLocaleString() ?? "0"}`,
        ),
      );
    if (detail.pendingContentErasure) {
      const pending = detail.pendingContentErasure;
      this.root.append(
        element(
          "p",
          `Shared-content erasure is pending for its confirmed snapshot of ${pending.collections} collections. Shared writes are paused; later content is not added to this action.`,
        ),
        button(
          "Resume confirmed shared-content erasure",
          () =>
            void this.change(
              create(HouseholdChangeSchema, {
                operationId: pending.operationId,
                householdId: household.id,
                expectedRevision: pending.expectedRevision,
                action: HouseholdAction.ERASE_CONTENT,
                confirmContentErasure: true,
              }),
              () => this.reloadHousehold(),
            ),
        ),
      );
    } else
      this.root.append(
        button(
          "Erase all shared content",
          () => void this.eraseSharedContent(),
        ),
      );
    this.root.append(
      usage,
      button("Leave household", () => void this.leaveHousehold()),
      element("h2", "Heads"),
    );
    for (const head of detail.heads) {
      const row = element("article");
      row.className = "household-card";
      row.append(
        element("h3", head.identity?.name ?? "Head"),
        element("p", "Equal head authority"),
      );
      const own = head.identity?.id === this.overview?.identity?.id;
      for (const [key, label] of resources.filter(([key]) => key !== "bytes"))
        row.append(
          element(
            "p",
            `${label} · ${own ? "created by you" : `created by ${head.identity?.name ?? "head"}`}: ${head.usage?.[key] ?? 0n} / ceiling ${head.ceilings?.[key] ?? 0n}`,
          ),
        );
      if (own)
        row.append(button("Edit my count ceilings", () => this.ceilingsForm()));
      if (!own)
        row.append(
          button(
            `Remove head ${head.identity?.name ?? "Head"}`,
            () => void this.removeHead(head.identity!.id, head.identity!.name),
          ),
        );
      this.root.append(row);
    }
    this.root.append(element("h2", "Invitations"));
    for (const invite of detail.invitations) {
      const row = element("article");
      row.className = "household-card";
      row.append(
        element(
          "p",
          `${invite.recipient?.name ?? "Approved person"} · ${invite.status} · expires ${new Date(Number(invite.expiresAt) * 1000).toLocaleString()}`,
        ),
      );
      if (invite.status === "pending")
        row.append(
          button(
            `Revoke invitation for ${invite.recipient?.name ?? "person"}`,
            () =>
              void this.revokeInvitation(
                invite.id,
                invite.recipient?.name ?? "person",
              ),
          ),
        );
      this.root.append(row);
    }
    if (this.deliveredLink) {
      const label = element("label", "Invitation link");
      label.htmlFor = "household-invitation-link";
      const input = element("input");
      input.id = label.htmlFor;
      input.readOnly = true;
      input.value = this.deliveredLink;
      this.root.append(
        label,
        input,
        element(
          "p",
          "Deliver this link manually to its named recipient. The server stores only a token hash; this link is shown only in this tab.",
        ),
      );
    }
    this.renderActivity();
  }
  private renderActivity() {
    const region = element("section");
    region.setAttribute("aria-label", "Household administrative History");
    region.append(element("h2", "Household administrative History"));
    for (const entry of this.activity) {
      const card = element("article");
      card.className = "history-entry";
      card.append(
        element("h3", entry.action),
        element(
          "p",
          `${entry.actor?.name ?? "Former head"} · ${new Date(Number(entry.occurredAt) * 1000).toLocaleString()}`,
        ),
      );
      const details = JSON.parse(entry.detailsJson) as {
        before?: Record<string, number>;
        after?: Record<string, number>;
        collections?: number;
        invitation?: string;
      };
      if (details.before && details.after)
        for (const [key, label] of resources) {
          if (
            key === "bytes" &&
            entry.action === "Changed own individual count ceilings"
          )
            continue;
          const before = details.before[key] ?? 0,
            after = details.after[key] ?? 0;
          if (before !== after)
            card.append(
              element(
                "p",
                `${label}: ${before.toLocaleString()} → ${after.toLocaleString()}`,
              ),
            );
        }
      if (details.collections !== undefined)
        card.append(
          element(
            "p",
            `Collections erased: ${details.collections.toLocaleString()}`,
          ),
        );
      if (details.invitation) {
        const recipient = this.details?.invitations.find(
          (i) => i.id === details.invitation,
        )?.recipient;
        if (recipient)
          card.append(element("p", `Recipient: ${recipient.name}`));
      }
      region.append(card);
    }
    if (this.activityCursor)
      region.append(
        button(
          "Load older administrative History",
          () => void this.olderActivity(),
        ),
      );
    this.root.append(region);
  }
  private async olderActivity() {
    this.hooks.busy(true);
    try {
      const page = await this.api.households.listHouseholdActivity(
        { householdId: this.api.space, beforeSequence: this.activityCursor },
        { timeoutMs: 90000 },
      );
      this.activity.push(...page.entries);
      this.activityCursor = page.nextBeforeSequence;
      this.renderHousehold();
    } catch (error) {
      this.problem(error);
    } finally {
      this.hooks.busy(false);
    }
  }
  private ceilingsForm() {
    const own = this.details?.heads.find(
      (head) => head.identity?.id === this.overview?.identity?.id,
    );
    if (!own || !this.details?.household) return;
    const household = this.details.household;
    this.root.replaceChildren(
      element("h1", "My individual count ceilings"),
      element(
        "p",
        "These ceilings do not reserve capacity or change the household pool. You can lower a ceiling below your usage; saved content remains. Other heads cannot edit your ceilings. Storage is shared, without individual byte ceilings.",
      ),
    );
    const form = element("form");
    form.className = "editor";
    const inputs = new Map<string, HTMLInputElement>();
    for (const [key, label] of resources.filter(([key]) => key !== "bytes")) {
      const input = element("input");
      input.id = `ceiling-${key}`;
      input.inputMode = "numeric";
      input.pattern = "[0-9]+";
      input.required = true;
      input.defaultValue = String(own.ceilings?.[key] ?? 0n);
      input.value = input.defaultValue;
      const fieldLabel = element("label", `My ${label} ceiling`);
      fieldLabel.htmlFor = input.id;
      inputs.set(key, input);
      form.append(fieldLabel, input);
    }
    const submit = element("button", "Review my ceilings");
    submit.type = "submit";
    form.append(
      submit,
      button("Back to household", () => void this.openHousehold()),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const amounts = create(ResourceAmountsSchema);
      for (const [key] of resources.filter(([key]) => key !== "bytes")) {
        const raw = inputs.get(key)!.value;
        if (!/^[0-9]+$/.test(raw) || BigInt(raw) > 9007199254740991n) {
          this.problem(
            new ConnectError(
              "Enter non-negative safe whole ceilings.",
              Code.InvalidArgument,
            ),
          );
          return;
        }
        amounts[key] = BigInt(raw);
      }
      void (async () => {
        const changes = resources
          .filter(([key]) => key !== "bytes")
          .map(
            ([key, label]) =>
              `${label}: ${own.ceilings?.[key].toLocaleString() ?? "0"} → ${amounts[key].toLocaleString()}`,
          )
          .join(". ");
        if (
          !(await this.hooks.confirm(
            "Apply your count ceilings?",
            `${changes}. Household capacity and other heads' ceilings stay unchanged.`,
            "Apply my ceilings",
            "Keep editing",
            `${own.identity?.name ?? "You"} · ${household.name}`,
          ))
        )
          return;
        await this.change(
          create(HouseholdChangeSchema, {
            operationId: crypto.randomUUID(),
            householdId: household.id,
            expectedRevision: household.revision,
            action: HouseholdAction.SET_OWN_CEILINGS,
            amounts,
          }),
          () => this.reloadHousehold(),
        );
      })();
    });
    this.root.append(form);
  }
  private inviteForm() {
    this.root.replaceChildren(element("h1", "Invite approved head"));
    const form = element("form");
    form.className = "editor";
    const label = element("label", "Recipient account ID");
    label.htmlFor = "recipient-account-id";
    const input = element("input");
    input.id = label.htmlFor;
    input.required = true;
    input.maxLength = 100;
    const submit = element("button", "Review invitation");
    submit.type = "submit";
    form.append(
      label,
      input,
      element(
        "p",
        "Ask the approved person for the account ID shown in their My capacity page. There is no public account directory.",
      ),
      submit,
      button("Back to household", () => void this.openHousehold()),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.invite(input.value.trim());
    });
    this.root.append(form);
    input.focus();
  }
  private async invite(recipient: string) {
    if (!this.details?.household) return;
    if (
      !(await this.hooks.confirm(
        "Invite this person as a head?",
        "This approved recipient will gain full shared access only after accepting. The invitation expires in seven days and does not allocate their personal capacity.",
        "Create invitation",
        "Keep editing",
        `${this.details.household.name} · Recipient ${recipient}`,
      ))
    )
      return;
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const request = create(HouseholdChangeSchema, {
      operationId: crypto.randomUUID(),
      householdId: this.details.household.id,
      expectedRevision: this.details.household.revision,
      action: HouseholdAction.INVITE,
      targetId: recipient,
      invitationToken: token,
    });
    await this.change(request, async () => {
      this.deliveredLink = `${location.origin}${location.pathname}#invite=${token}`;
      await this.reloadHousehold();
    });
  }
  private async eraseSharedContent() {
    const household = this.details?.household;
    if (!household || this.details?.pendingContentErasure) return;
    if (
      !(await this.hooks.confirm(
        "Erase all shared content permanently?",
        "This permanently erases the household's retained tasks, lists, templates, runs, child items, sections and associated content History, including Archive and Trash, present when this action starts. Shared writes pause while protection is pending. Independent copies in other spaces remain. The household name, heads and contributions remain; allocated capacity stays reserved until you explicitly withdraw it.",
        "Erase shared content permanently",
        "Cancel",
        household.name,
      ))
    )
      return;
    await this.change(
      create(HouseholdChangeSchema, {
        operationId: crypto.randomUUID(),
        householdId: household.id,
        expectedRevision: household.revision,
        action: HouseholdAction.ERASE_CONTENT,
        confirmContentErasure: true,
      }),
      () => this.reloadHousehold(),
    );
  }
  private async leaveHousehold() {
    if (!this.details?.household) return;
    const detail = this.details;
    const household = detail.household!;
    const closing = detail.heads.length === 1;
    const due = new Date(Number(detail.closureEraseDueAt) * 1000);
    const description = closing
      ? `Closure is final: no reopening or rejoining. Pending invitations will be revoked and content erased at ${due.toISOString()} UTC (${due.toLocaleString()} local). Your capacity remains reserved until protected erasure succeeds. No successor or cleanup is required before leaving.`
      : "Access ends immediately. Shared content and creator attribution remain. Your contribution stays reserved when needed; manage only your own retained allocation from My capacity. Other heads retain equal authority.";
    if (
      !(await this.hooks.confirm(
        closing ? "Leave and close this household?" : "Leave this household?",
        description,
        closing ? "Leave and close household" : "Leave household",
        "Cancel",
        household.name,
      ))
    )
      return;
    await this.change(
      create(HouseholdChangeSchema, {
        operationId: crypto.randomUUID(),
        householdId: household.id,
        expectedRevision: household.revision,
        action: HouseholdAction.LEAVE,
        confirmClose: closing,
        expectedEraseDueAt: closing ? detail.closureEraseDueAt : 0n,
      }),
      async () => {
        this.hooks.clearContent();
        this.details = undefined;
        this.api.space = "personal";
        this.message = closing
          ? "Household closed. Closure is final; retained capacity waits for protected erasure."
          : "You left the household. Retained contributions are managed here.";
        this.renderCapacity();
      },
    );
  }
  private async removeHead(id: string, name: string) {
    if (!this.details?.household) return;
    if (
      !(await this.hooks.confirm(
        "Remove this head?",
        "Access ends on the next request. Their shared content and attribution remain; needed contributed capacity stays reserved. This does not affect their private account.",
        "Remove head",
        "Cancel",
        `${name} · ${this.details.household.name}`,
      ))
    )
      return;
    await this.change(
      create(HouseholdChangeSchema, {
        operationId: crypto.randomUUID(),
        householdId: this.details.household.id,
        expectedRevision: this.details.household.revision,
        action: HouseholdAction.REMOVE_HEAD,
        targetId: id,
      }),
      () => this.reloadHousehold(),
    );
  }
  private async revokeInvitation(id: string, name: string) {
    if (!this.details?.household) return;
    if (
      !(await this.hooks.confirm(
        "Revoke this invitation?",
        "The recipient will no longer be able to accept this link.",
        "Revoke invitation",
        "Cancel",
        `${name} · ${this.details.household.name}`,
      ))
    )
      return;
    await this.change(
      create(HouseholdChangeSchema, {
        operationId: crypto.randomUUID(),
        householdId: this.details.household.id,
        expectedRevision: this.details.household.revision,
        action: HouseholdAction.REVOKE_INVITATION,
        targetId: id,
      }),
      () => this.reloadHousehold(),
    );
  }
  private async change(request: HouseholdChange, after: () => Promise<void>) {
    if (this.pending && this.pending.operationId !== request.operationId)
      return;
    this.pending = request;
    this.hooks.busy(true);
    try {
      await this.api.households.changeHousehold(request, { timeoutMs: 90000 });
      this.pending = undefined;
      await this.refresh();
      await after();
    } catch (error) {
      if (
        request.action === HouseholdAction.LEAVE &&
        !(error instanceof ContextChanged)
      ) {
        try {
          await this.refresh();
          const closed = this.overview?.households.find(
            (h) =>
              h.id === request.householdId &&
              ["closed", "erasing", "erased"].includes(h.status),
          );
          if (closed) {
            this.pending = undefined;
            this.details = undefined;
            this.hooks.clearContent();
            this.api.space = "personal";
            if (closed.closureProtectionPending)
              this.closureRetries.set(closed.id, request);
            else this.closureRetries.delete(closed.id);
            this.message = closed.closureProtectionPending
              ? "Household closed. Recovery protection is pending; retained capacity stays reserved."
              : "Household closure is confirmed.";
            this.renderCapacity();
            return;
          }
        } catch (refreshError) {
          if (refreshError instanceof ContextChanged) return;
        }
      }
      if (
        error instanceof ConnectError &&
        [
          Code.InvalidArgument,
          Code.FailedPrecondition,
          Code.ResourceExhausted,
          Code.NotFound,
        ].includes(error.code)
      )
        this.pending = undefined;
      this.problem(error);
      if (this.pending) {
        for (const input of this.root.querySelectorAll("input"))
          input.readOnly = true;
        for (const action of this.root.querySelectorAll("button"))
          action.disabled = true;
        this.root.append(
          button(
            "Retry pending change",
            () => void this.change(request, after),
          ),
        );
      }
    } finally {
      this.hooks.busy(false);
    }
  }
}
