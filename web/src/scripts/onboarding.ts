import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  InvitationAcceptanceSchema,
  type InvitationAcceptance,
  type OnboardingPreview,
} from "../gen/life/v1/accounts_pb";
import { Api, ContextChanged, needsLogin } from "../lib/api";
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "") {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
}
type Hooks = {
  show(): void;
  busy(value: boolean): void;
  complete(household: string): Promise<void>;
  signIn(): Promise<void>;
};
export class Onboarding {
  active = false;
  private secret = "";
  private preview?: OnboardingPreview;
  private pending?: InvitationAcceptance;
  private draft = { identity: "", name: "" };
  constructor(
    private root: HTMLElement,
    private api: Api,
    private hooks: Hooks,
  ) {}
  setToken(token: string) {
    this.secret = token;
    this.pending = undefined;
  }
  token() {
    return this.secret;
  }
  verified() {
    this.secret = "";
  }
  reset() {
    this.active = false;
    this.secret = "";
    this.preview = undefined;
    this.pending = undefined;
    this.draft = { identity: "", name: "" };
    this.root.replaceChildren();
  }
  private button(label: string, click: () => void, primary = false) {
    const b = el("button", label);
    b.type = "button";
    if (primary) b.className = "primary";
    b.onclick = click;
    return b;
  }
  async open() {
    this.active = true;
    this.hooks.show();
    this.hooks.busy(true);
    try {
      this.preview = await this.api.invitations.getOnboarding(
        {},
        { timeoutMs: 90000 },
      );
      if (this.draft.identity !== this.api.identity)
        this.draft = {
          identity: this.api.identity,
          name: this.preview.displayName,
        };
      this.render();
    } catch (error) {
      if (error instanceof ContextChanged) return;
      this.root.replaceChildren(
        el("h1", "This invitation is unavailable"),
        el(
          "p",
          error instanceof ConnectError && error.code === Code.Unauthenticated
            ? "Reopen the invitation email and sign in again. If it expired or was revoked, ask a household head for a new invitation."
            : "Check your connection and try again. Your account and tasks have not been changed.",
        ),
        this.button("Try again", () => void this.open()),
        this.button("Back to sign in", () => void this.cancel()),
      );
    } finally {
      this.hooks.busy(false);
    }
  }
  private render() {
    const p = this.preview;
    if (!p) return;
    if (p.status === "accepted") {
      this.joined();
      return;
    }
    this.root.replaceChildren(
      el("h1", `Join ${p.householdName}`),
      el("p", "Your Google address matches this invitation."),
    );
    if (p.growthPaused) {
      this.root.append(
        el(
          "p",
          "Joining is temporarily paused. Your invitation has not been accepted; its expiry still applies.",
        ),
        this.button("Try again", () => void this.open()),
        this.button("Not now", () => void this.cancel()),
      );
      return;
    }
    const emailLabel = el("label", "Google account email");
    emailLabel.htmlFor = "join-google-email";
    const email = el("input");
    email.id = emailLabel.htmlFor;
    email.readOnly = true;
    email.value = p.email;
    this.root.append(emailLabel, email);
    if (!p.existingAccount) {
      const label = el("label", "Your display name");
      label.htmlFor = "join-display-name";
      const name = el("input");
      name.id = label.htmlFor;
      name.maxLength = 100;
      name.value = this.draft.name;
      name.oninput = () => {
        this.draft = { identity: this.api.identity, name: name.value };
      };
      this.root.append(label, name);
    } else
      this.root.append(
        el(
          "p",
          `Your existing account and name (${p.displayName}) will be kept.`,
        ),
      );
    const notice = el(
      "div",
      "You will become an equal head and can see all retained household content and History, including changes from before you joined. Your personal space stays private.",
    );
    notice.className = "household-card";
    const feedback = el("p");
    feedback.id = "join-feedback";
    feedback.className = "error";
    feedback.setAttribute("role", "alert");
    feedback.hidden = true;
    const actions = el("div");
    actions.className = "row-actions";
    actions.append(
      this.button(
        p.existingAccount ? "Accept and join" : "Create account and join",
        () => void this.accept(),
        true,
      ),
      this.button("Not now", () => void this.cancel()),
    );
    this.root.append(notice, feedback, actions);
  }
  private async accept() {
    const p = this.preview;
    if (!p) return;
    const name = p.existingAccount ? p.displayName : this.draft.name.trim();
    const feedback = this.root.querySelector<HTMLElement>("#join-feedback");
    if (!name) {
      if (feedback) {
        feedback.hidden = false;
        feedback.textContent = "Enter your display name.";
      }
      this.root.querySelector<HTMLInputElement>("#join-display-name")?.focus();
      return;
    }
    this.pending ??= create(InvitationAcceptanceSchema, {
      operationId: crypto.randomUUID(),
      displayName: name,
      confirmed: true,
    });
    this.hooks.busy(true);
    try {
      await this.api.invitations.acceptInvitation(this.pending, {
        timeoutMs: 90000,
      });
      await this.api.session();
      this.pending = undefined;
      this.joined();
    } catch (error) {
      if (error instanceof ContextChanged) return;
      if (
        error instanceof ConnectError &&
        [
          Code.InvalidArgument,
          Code.FailedPrecondition,
          Code.PermissionDenied,
        ].includes(error.code)
      )
        this.pending = undefined;
      if (feedback) {
        feedback.hidden = false;
        feedback.textContent =
          error instanceof ConnectError
            ? error.rawMessage
            : "Your acceptance could not be confirmed. Retry the same action or reopen the email; joining cannot create duplicate membership.";
      }
      if (this.pending) {
        const field =
          this.root.querySelector<HTMLInputElement>("#join-display-name");
        if (field) field.readOnly = true;
      }
    } finally {
      this.hooks.busy(false);
    }
  }
  private joined() {
    const p = this.preview;
    if (!p) return;
    this.root.replaceChildren(
      el("h1", `You joined ${p.householdName}`),
      el("p", "Your account is ready. Your personal lists stay private."),
      this.button(
        "Open household",
        () => void this.finish(p.householdId),
        true,
      ),
      this.button("Go to personal space", () => void this.finish("personal")),
    );
  }
  private async finish(id: string) {
    this.hooks.busy(true);
    try {
      await this.api.session();
      if (this.api.onboarding) {
        this.root.replaceChildren(
          el("h1", "Your household was joined"),
          el(
            "p",
            "Sign in again to open your account. The membership is already saved.",
          ),
          this.button("Continue with Google", () => void this.cancel()),
        );
        return;
      }
      this.active = false;
      await this.hooks.complete(id);
    } catch (error) {
      if (error instanceof ContextChanged) return;
      const message = el(
        "p",
        "Opening your account could not be confirmed. Check your connection and try again.",
      );
      message.className = "error";
      message.setAttribute("role", "alert");
      this.root.append(message);
    } finally {
      this.hooks.busy(false);
    }
  }
  private async cancel() {
    this.hooks.busy(true);
    try {
      await this.api.request("/auth/logout", {});
    } catch (error) {
      if (!needsLogin(error)) {
        const message = el(
          "p",
          "Sign-out could not be confirmed. Please try again.",
        );
        message.className = "error";
        message.setAttribute("role", "alert");
        this.root.append(message);
        this.hooks.busy(false);
        return;
      }
    }
    this.reset();
    this.api.csrf = "";
    this.api.onboarding = false;
    this.api.isAdmin = false;
    try {
      await this.hooks.signIn();
    } finally {
      this.hooks.busy(false);
    }
  }
}
