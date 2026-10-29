import { Api } from "../lib/api";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
function button(label: string, action: () => void) {
  const node = el("button", label);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

export class Requests {
  token = "";
  lookup = false;
  malformed = false;
  private operation = "";
  private withdrawals = new Map<string, string>();
  constructor(
    private root: HTMLElement,
    private api: Api,
    private show: () => void,
    private busy: (value: boolean) => void,
    private signIn: () => Promise<void>,
  ) {
    this.capture();
    window.addEventListener("hashchange", () => {
      if (this.capture()) void this.signIn();
    });
  }
  private capture() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.has("request") && !params.has("requests")) return false;
    this.lookup = params.has("requests");
    const token = params.get("request") ?? "";
    this.malformed = !this.lookup && !/^[a-f0-9]{64}$/.test(token);
    this.token = this.lookup || this.malformed ? "" : token;
    this.operation = "";
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  }
  startLookup() {
    this.token = "";
    this.lookup = true;
    this.malformed = false;
    void this.signIn();
  }
  verified() {
    this.token = "";
    this.lookup = false;
  }
  private async leave() {
    this.busy(true);
    try {
      await this.api.request("/auth/logout", {});
      this.api.requestSession = false;
      this.api.requestLookup = false;
      this.api.csrf = "";
      this.token = "";
      this.lookup = false;
      this.root.replaceChildren();
      await this.signIn();
    } catch {
      this.root.append(el("p", "Sign-out could not be confirmed. Try again."));
    } finally {
      this.busy(false);
    }
  }
  async open() {
    this.show();
    this.busy(true);
    try {
      if (this.api.requestLookup) {
        await this.openMine();
        return;
      }
      const preview = await this.api.invitations.getRequestPreview(
        {},
        { timeoutMs: 90000 },
      );
      this.root.replaceChildren(
        el("h1", `Request an invitation to ${preview.householdName}`),
        el(
          "p",
          preview.alreadyHead
            ? "You already have access to this household."
            : "A household head will review your request.",
        ),
      );
      if (!preview.alreadyHead) {
        this.root.append(
          el("p", `Google email: ${preview.email}`),
          el(
            "p",
            "An invitation may be sent to this address, including technical retries or a head's resend within 30 days. This is not marketing consent.",
          ),
          button("Request invitation email", () => void this.submit()),
        );
      }
      this.root.append(
        button("My invitation requests", () => this.startLookup()),
        button("Sign out", () => void this.leave()),
      );
    } catch {
      this.root.replaceChildren(
        el("h1", "This request is unavailable"),
        el(
          "p",
          "Check your connection or ask a household head for a new request link.",
        ),
        button("Try again", () => void this.open()),
      );
    } finally {
      this.busy(false);
    }
  }
  private async submit() {
    this.operation ||= crypto.randomUUID();
    this.busy(true);
    try {
      await this.api.invitations.submitInvitationRequest(
        { operationId: this.operation, confirmed: true },
        { timeoutMs: 90000 },
      );
      this.root.replaceChildren(
        el("h1", "Your request is pending"),
        el(
          "p",
          "A household head can review your request. You can return to check or withdraw it.",
        ),
        button("My invitation requests", () => this.startLookup()),
        button("Sign out", () => void this.leave()),
      );
      this.operation = "";
    } catch {
      this.root.append(
        el("p", "The request could not be confirmed. Try again."),
      );
    } finally {
      this.busy(false);
    }
  }
  private async openMine() {
    const page = await this.api.invitations.listMyInvitationRequests(
      {},
      { timeoutMs: 90000 },
    );
    this.root.replaceChildren(el("h1", "My invitation requests"));
    if (!page.requests.length)
      this.root.append(el("p", "You have no retained invitation requests."));
    for (const request of page.requests) {
      const card = el("article");
      card.className = "household-card";
      card.append(
        el("h2", request.householdName),
        el("p", `${request.email} · ${request.status}`),
      );
      if (["pending", "approved"].includes(request.status))
        card.append(
          button("Withdraw request", () => void this.withdraw(request.id)),
        );
      this.root.append(card);
    }
    this.root.append(
      button("Refresh requests", () => void this.open()),
      button("Sign out", () => void this.leave()),
    );
  }
  private async withdraw(id: string) {
    if (
      !window.confirm(
        "Withdraw this request and revoke any unaccepted invitation?",
      )
    )
      return;
    this.busy(true);
    try {
      const operationId = this.withdrawals.get(id) ?? crypto.randomUUID();
      this.withdrawals.set(id, operationId);
      await this.api.invitations.withdrawInvitationRequest(
        { operationId, requestId: id, confirmed: true },
        { timeoutMs: 90000 },
      );
      this.withdrawals.delete(id);
      await this.openMine();
    } catch {
      this.root.append(
        el("p", "Withdrawal could not be confirmed. Try again."),
      );
    } finally {
      this.busy(false);
    }
  }
}
