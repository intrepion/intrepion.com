import { Onboarding } from "./onboarding";
import { Administration } from "./administration";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { TaskSchema, type Task } from "../gen/life/v1/tasks_pb";
import { Households } from "./households";
import { Everyday } from "./everyday";
import { Api, HttpError, needsLogin, ContextChanged } from "../lib/api";
import { ordered, validate, type Fields } from "../lib/model";

function get<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing application element ${id}`);
  return element as T;
}
function text(id: string, value: string) {
  get(id).textContent = value;
}
function show(id: string, visible: boolean) {
  get(id).hidden = !visible;
}
function supportContact(address: string) {
  api.supportEmail = address;
  const link = get<HTMLAnchorElement>("contact-support");
  if (address) link.href = `mailto:${encodeURIComponent(address)}`;
  else link.removeAttribute("href");
  show("support-contact", !!address);
}
function focus(id: string) {
  get(id).focus();
}
const api = new Api(get("app").dataset.apiOrigin!);
let tasks: Task[] = [];
let authenticated = false;
let lastIdentity = "";
let busy = false;
type Configuration = {
  google_client_id: string;
  development: boolean;
  normal_accounts: boolean;
  support_email: string;
};
let config: Configuration | undefined;
type Editor = { id: string; original?: Task; fields: Fields };
let editor: Editor | undefined;
type Action =
  | { kind: "create" | "update"; task: Task }
  | { kind: "delete"; id: string; revision: number };
let pending: Action | undefined;
let recoveryTaskId = "";
let googleScript: Promise<void> | undefined;

type GoogleId = {
  initialize(options: {
    client_id: string;
    nonce: string;
    auto_select: boolean;
    callback: (result: { credential: string }) => void;
  }): void;
  renderButton(
    element: HTMLElement,
    options: { theme: string; size: string; text: string; shape: string },
  ): void;
  disableAutoSelect(): void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

function announce(message: string) {
  text("announcement", message);
}
function setBusy(value: boolean) {
  busy = value;
  get("app").setAttribute("aria-busy", String(value));
  get("app")
    .querySelectorAll<
      | HTMLButtonElement
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
    >("button,input,textarea,select")
    .forEach((element) => {
      if (value && !element.disabled) {
        element.dataset.busyDisabled = "true";
        element.disabled = true;
      } else if (!value && element.dataset.busyDisabled) {
        element.disabled = false;
        delete element.dataset.busyDisabled;
      }
    });
}
function view(
  name:
    | "status"
    | "list"
    | "editor"
    | "everyday"
    | "household"
    | "admin"
    | "onboarding",
) {
  if (name !== "status") spaces.active = name === "household";
  for (const candidate of [
    "status",
    "list",
    "editor",
    "everyday",
    "household",
    "admin",
    "onboarding",
  ])
    show(`${candidate}-view`, candidate === name);
  show("nav-admin", authenticated && api.isAdmin);
  show("account", authenticated);
  show("space-controls", authenticated);
  show("main-nav", authenticated);
}
function status(title: string, description: string, loading = false) {
  view("status");
  text("status-title", title);
  text("status-description", description);
  get("status-view").querySelector<HTMLElement>(".spinner")!.hidden = !loading;
  show("google-button", false);
  show("development-login", false);
  show("development-morgan", false);
  show("development-another", false);
  show("development-identity-form", false);
  show("retry-load", !loading);
}
function errorMessage(error: unknown): string {
  if (
    error instanceof ConnectError &&
    [Code.FailedPrecondition, Code.ResourceExhausted].includes(error.code)
  )
    return error.rawMessage;
  if (error instanceof ConnectError && error.code === Code.NotFound)
    return "This task no longer exists. Reload the list; your draft is still here.";
  return "The action could not be confirmed. Your last confirmed state and draft are unchanged. Retry the same action, or reload the list.";
}
function row(task: Task): HTMLElement {
  const article = document.createElement("article");
  article.className = `task${task.completed ? " done" : ""}`;
  article.id = `task-${task.id}`;
  const toggle = document.createElement("button");
  toggle.className = "task-toggle";
  toggle.setAttribute("role", "checkbox");
  toggle.setAttribute("aria-checked", String(task.completed));
  toggle.setAttribute(
    "aria-label",
    `${task.completed ? "Reopen" : "Complete"} task: ${task.title}`,
  );
  const check = document.createElement("span");
  check.setAttribute("aria-hidden", "true");
  check.textContent = task.completed ? "✓" : "";
  toggle.append(check);
  toggle.addEventListener(
    "click",
    () =>
      void mutate({
        kind: "update",
        task: create(TaskSchema, { ...task, completed: !task.completed }),
      }),
  );
  const copy = document.createElement("div");
  copy.className = "task-copy";
  const title = document.createElement("p");
  title.className = "task-title";
  title.textContent = task.title;
  copy.append(title);
  if (task.notes) {
    const notes = document.createElement("p");
    notes.className = "task-notes";
    notes.textContent = task.notes;
    copy.append(notes);
  }
  const actions = document.createElement("div");
  actions.className = "task-actions";
  const edit = document.createElement("button");
  edit.className = "quiet";
  edit.textContent = "Edit";
  edit.setAttribute("aria-label", `Edit task: ${task.title}`);
  edit.addEventListener("click", () => openEditor(task));
  const remove = document.createElement("button");
  remove.className = "quiet delete";
  remove.textContent = "Move to Trash";
  remove.setAttribute("aria-label", `Move task to Trash: ${task.title}`);
  remove.addEventListener("click", async () => {
    if (
      await confirm(
        "Move this task to Trash?",
        "Its history is retained. You can restore this task from Trash.",
        "Move to Trash",
        "Cancel",
        task.title,
      )
    )
      await mutate({ kind: "delete", id: task.id, revision: task.revision });
  });
  const history = document.createElement("button");
  history.className = "quiet";
  history.textContent = "History";
  history.setAttribute("aria-label", `Task history: ${task.title}`);
  history.addEventListener("click", () => void everyday.taskHistory(task.id));
  if (task.erasurePending) {
    toggle.disabled = true;
    edit.disabled = true;
    remove.disabled = true;
    actions.append(buttonForRecovery(task));
  }
  actions.append(edit, history, remove);
  article.append(toggle, copy, actions);
  return article;
}
function buttonForRecovery(task: Task) {
  const button = document.createElement("button");
  button.textContent = `Resume erasure: ${task.title}`;
  button.addEventListener(
    "click",
    () => void everyday.storageRecovery(task.id),
  );
  return button;
}
function renderList() {
  view("list");
  show("list-error", false);
  show("empty", tasks.length === 0);
  const open = tasks.filter((task) => !task.completed);
  const done = tasks.filter((task) => task.completed);
  text("task-count", `${open.length} open`);
  text("completed-count", String(done.length));
  show("completed-heading", tasks.length > 0);
  get("open-tasks").replaceChildren(...open.map(row));
  get("completed-tasks").replaceChildren(...done.map(row));
}
function dirty(): boolean {
  return (
    !!editor &&
    (editor.fields.title !== (editor.original?.title ?? "") ||
      editor.fields.notes !== (editor.original?.notes ?? ""))
  );
}
function renderEditor() {
  if (!editor) return;
  view("editor");
  text("editor-heading", editor.original ? "Edit task" : "New task");
  text("save-task", editor.original ? "Save changes" : "Save task");
  show("save-error", false);
  get<HTMLInputElement>("title").value = editor.fields.title;
  get<HTMLTextAreaElement>("notes").value = editor.fields.notes;
  for (const field of ["title", "notes"]) {
    get(field).removeAttribute("aria-invalid");
    text(`${field}-error`, "");
  }
  counters();
}
function openEditor(task?: Task) {
  if (busy) return;
  pending = undefined;
  editor = {
    id: task?.id ?? crypto.randomUUID(),
    ...(task ? { original: task } : {}),
    fields: { title: task?.title ?? "", notes: task?.notes ?? "" },
  };
  renderEditor();
  focus("title");
}
function counters() {
  if (!editor) return;
  text("title-count", `${[...editor.fields.title].length} / 200`);
  text(
    "notes-count",
    `${[...editor.fields.notes].length.toLocaleString("en-US")} / 10,000`,
  );
}
async function confirm(
  title: string,
  description: string,
  accept: string,
  cancel: string,
  task?: string,
): Promise<boolean> {
  const previous = document.activeElement as HTMLElement | null;
  const dialog = get<HTMLDialogElement>("confirm");
  text("confirm-title", title);
  text("confirm-description", description);
  text("confirm-accept", accept);
  text("confirm-cancel", cancel);
  text("confirm-task", task ?? "");
  show("confirm-task", !!task);
  dialog.returnValue = "";
  dialog.showModal();
  focus("confirm-cancel");
  return new Promise((resolve) =>
    dialog.addEventListener(
      "close",
      () => {
        if (previous?.isConnected) previous.focus();
        text("confirm-task", "");
        resolve(dialog.returnValue === "accept");
      },
      { once: true },
    ),
  );
}
get("confirm-accept").addEventListener("click", () =>
  get<HTMLDialogElement>("confirm").close("accept"),
);
get("confirm-cancel").addEventListener("click", () =>
  get<HTMLDialogElement>("confirm").close("cancel"),
);
async function leaveEditor() {
  if (busy) return;
  if (
    dirty() &&
    !(await confirm(
      "Discard your changes?",
      "Your unsaved changes will be lost.",
      "Discard changes",
      "Keep editing",
    ))
  )
    return;
  editor = undefined;
  pending = undefined;
  await loadTasks();
}
function expired() {
  authenticated = false;
  everyday.suspend();
  api.csrf = "";
  status(
    "Your session has expired",
    editor
      ? "Your draft is still here. Sign in again to continue."
      : "Sign in again to open your tasks.",
  );
  text("retry-load", "Sign in again");
  announce("Your session has expired. Your draft is preserved in this tab.");
}
async function mutate(action: Action) {
  if (busy) return;
  pending = action;
  setBusy(true);
  show("save-error", false);
  show("list-error", false);
  try {
    if (action.kind === "delete") {
      await api.tasks.deleteTask(
        { id: action.id, revision: action.revision },
        { timeoutMs: 90000 },
      );
      tasks = tasks.filter((task) => task.id !== action.id);
    } else {
      const saved = await (action.kind === "create"
        ? api.tasks.createTask(action.task, { timeoutMs: 90000 })
        : api.tasks.updateTask(action.task, { timeoutMs: 90000 }));
      tasks = ordered([...tasks.filter((task) => task.id !== saved.id), saved]);
    }
    pending = undefined;
    editor = undefined;
    renderList();
    announce(action.kind === "delete" ? "Task moved to Trash." : "Task saved.");
    get("list-view").querySelector<HTMLElement>("h1")?.focus();
  } catch (error) {
    if (error instanceof ContextChanged) return;
    if (
      error instanceof ConnectError &&
      [
        Code.ResourceExhausted,
        Code.FailedPrecondition,
        Code.NotFound,
        Code.PermissionDenied,
      ].includes(error.code)
    )
      pending = undefined;
    if (needsLogin(error)) {
      expired();
    } else {
      if (
        action.kind === "delete" &&
        error instanceof ConnectError &&
        error.code === Code.ResourceExhausted
      ) {
        recoveryTaskId = action.id;
        show("storage-recovery", true);
      }
      const target = editor ? "save-error" : "list-error";
      show(target, true);
      get(target).querySelector("p")!.textContent = errorMessage(error);
      announce(errorMessage(error));
      if (editor) text("save-task", "Try saving again");
    }
  } finally {
    setBusy(false);
  }
}
async function loadTasks() {
  setBusy(true);
  status("Opening your list", "The server may take a minute to wake up.", true);
  try {
    config ??= await api.request<Configuration>("/auth/config");
    api.normalAccounts = !!config.normal_accounts;
    supportContact(config.support_email ?? "");
    if (showMalformedInvitation()) return;
    if (api.normalAccounts && spaces.hasInvitation())
      onboarding.setToken(spaces.takeInvitation());
    if (onboarding.token()) {
      authenticated = false;
      await signInView();
      return;
    }
    await api.session();
    if (api.onboarding) {
      authenticated = false;
      clearContent();
      spaces.reset();
      await onboarding.open();
      return;
    }
    if (lastIdentity && lastIdentity !== api.identity) {
      clearContent();
      spaces.reset();
      api.space = "personal";
    }
    lastIdentity = api.identity;
    authenticated = true;
    await spaces.refresh();
    text(
      "account-identity",
      `${api.displayName} · ${api.normalAccounts ? "Google account" : "Approved Google account"}`,
    );
    text(
      "task-privacy",
      api.space === "personal"
        ? "Plain text. Your personal space is private."
        : "Shared household content. Every current head can view and change it.",
    );
    tasks = ordered(
      (await api.tasks.listTasks({}, { timeoutMs: 90000 })).tasks,
    );
    if (spaces.hasInvitation()) {
      await spaces.openInvitation();
    } else if (admin.active) {
      await admin.open(true);
    } else if (spaces.active) {
      spaces.resume();
    } else if (everyday.active) {
      everyday.resume();
    } else if (editor) {
      renderEditor();
      focus("title");
    } else {
      renderList();
    }
  } catch (error) {
    if (error instanceof ContextChanged) return;
    if (needsLogin(error)) {
      authenticated = false;
      await signInView();
    } else {
      status(
        "Your list is unavailable",
        "Your tasks have not been changed. Check your connection and try again.",
      );
    }
  } finally {
    setBusy(false);
  }
}
async function sdk(): Promise<void> {
  if (window.google) return;
  googleScript ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      googleScript = undefined;
      script.remove();
      reject(new Error("Google sign-in could not load."));
    };
    document.head.append(script);
  });
  await googleScript;
}
async function signInView() {
  status(
    editor ? "Sign in to continue" : "A little clarity for your day",
    editor
      ? "Your draft is preserved in this tab."
      : "Your personal task list. Sign in with your approved Google account.",
  );
  show("retry-load", false);
  try {
    config = await api.request<Configuration>("/auth/config");
    api.normalAccounts = !!config.normal_accounts;
    supportContact(config.support_email ?? "");
    if (showMalformedInvitation()) return;
    if (api.normalAccounts && spaces.hasInvitation())
      onboarding.setToken(spaces.takeInvitation());
    if (api.normalAccounts && !editor) {
      text(
        "status-title",
        onboarding.token()
          ? "You have a household invitation"
          : "A little clarity for your day",
      );
      text(
        "status-description",
        onboarding.token()
          ? "Sign in with the Google account for the address that received the email. Review before joining; opening the link does not create an account."
          : "Your personal lists and shared households. New here? Open a household invitation email to create your account.",
      );
    }
    const { nonce } = await api.request<{ nonce: string }>(
      "/auth/challenge",
      {},
    );
    if (config.development) {
      show("development-login", true);
      show("development-morgan", !api.normalAccounts);
      show("development-another", api.normalAccounts);
      get("development-another").onclick = () => {
        show("development-identity-form", true);
        get("development-email").focus();
      };
      get<HTMLFormElement>("development-identity-form").onsubmit = (event) => {
        event.preventDefault();
        const email = get<HTMLInputElement>("development-email")
          .value.trim()
          .toLowerCase();
        void authenticate(
          "/auth/development",
          nonce,
          `development-email:${email}`,
          { email, name: get<HTMLInputElement>("development-name").value },
        );
      };
      get("development-morgan").onclick = () =>
        void authenticate("/auth/development", nonce, "development-second");
      get("development-login").onclick = () =>
        void authenticate("/auth/development", nonce);
      return;
    }
    await sdk();
    get("google-button").replaceChildren();
    show("google-button", true);
    window.google!.accounts.id.initialize({
      client_id: config.google_client_id,
      nonce,
      auto_select: false,
      callback: (result) =>
        void authenticate("/auth/google", nonce, result.credential),
    });
    window.google!.accounts.id.renderButton(get("google-button"), {
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
    });
    // Refreshing the screen obtains a new challenge after a canceled/expired popup.
    text("retry-load", "Reload sign-in");
    show("retry-load", true);
  } catch {
    status("Sign-in is unavailable", "Check your connection and try again.");
    text("retry-load", "Try again");
  }
}
function showMalformedInvitation() {
  if (!spaces.takeMalformedInvitation()) return false;
  onboarding.setToken("");
  authenticated = false;
  status(
    "This invitation is unavailable",
    "Open the newest invitation email or ask a household head for a new invitation. Your account and tasks have not been changed.",
  );
  text("retry-load", "Back to sign-in");
  return true;
}
async function authenticate(
  path: string,
  nonce: string,
  credential = "",
  development?: { email: string; name: string },
) {
  if (busy) return;
  setBusy(true);
  try {
    const token = onboarding.token();
    await api.login(
      path,
      nonce,
      credential,
      token,
      token
        ? (development ?? {
            email: "development-owner@example.invalid",
            name: "Owner",
          })
        : undefined,
    );
    onboarding.verified();
    if (api.onboarding) {
      authenticated = false;
      clearContent();
      spaces.reset();
      await onboarding.open();
      return;
    }
    authenticated = true;
    await loadTasks();
  } catch (error) {
    if (error instanceof ContextChanged) return;
    const accessDenied = error instanceof HttpError && error.status === 403;
    const invitationUnavailable =
      error instanceof HttpError && error.status === 410;
    status(
      invitationUnavailable
        ? "This invitation is unavailable"
        : accessDenied
          ? onboarding.token()
            ? "Choose another Google account"
            : "This account does not have access"
          : "Sign-in could not be completed",
      invitationUnavailable
        ? "Open the newest invitation email or ask a household head for a new invitation. Your account and tasks have not been changed."
        : accessDenied
          ? onboarding.token()
            ? "Use the Google address that received the invitation email. The invitation has not been consumed."
            : api.normalAccounts
              ? "Use an available account. New accounts need a household invitation email."
              : "Try signing in with your approved Google account."
          : error instanceof HttpError
            ? error.message
            : "Please check your connection and try again.",
    );
    text("retry-load", "Try signing in again");
  } finally {
    setBusy(false);
  }
}
get("new-task").addEventListener("click", () => openEditor());
get("first-task").addEventListener("click", () => openEditor());
get("back-to-list").addEventListener("click", () => void leaveEditor());
get("cancel-edit").addEventListener("click", () => void leaveEditor());
get("editor-reload").addEventListener("click", () => void leaveEditor());
get("retry-load").addEventListener("click", () => {
  if (authenticated) void loadTasks();
  else {
    setBusy(true);
    void signInView().finally(() => setBusy(false));
  }
});
get("retry-action").addEventListener("click", () => {
  if (pending) void mutate(pending);
});
get("reload-list").addEventListener("click", () => {
  pending = undefined;
  void loadTasks();
});
for (const field of ["title", "notes"] as const) {
  get(field).addEventListener("input", () => {
    if (!editor) return;
    editor.fields[field] = get<HTMLInputElement | HTMLTextAreaElement>(
      field,
    ).value;
    get(field).removeAttribute("aria-invalid");
    text(`${field}-error`, "");
    counters();
  });
}
get("task-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!editor || busy) return;
  const errors = validate(editor.fields);
  for (const field of ["title", "notes"] as const) {
    text(`${field}-error`, errors[field] ?? "");
    get(field).setAttribute("aria-invalid", String(!!errors[field]));
  }
  if (errors.title || errors.notes) {
    focus(errors.title ? "title" : "notes");
    announce("Check the highlighted fields.");
    return;
  }
  void mutate({
    kind: editor.original ? "update" : "create",
    task: create(TaskSchema, {
      id: editor.id,
      ...editor.fields,
      completed: editor.original?.completed ?? false,
      revision: editor.original?.revision ?? 0,
    }),
  });
});
get("sign-out").addEventListener("click", async () => {
  if (busy) return;
  if (
    (dirty() ||
      everyday.dirty() ||
      spaces.dirty() ||
      spaces.hasPending() ||
      admin.dirty() ||
      admin.hasPending()) &&
    !(await confirm(
      "Discard your changes?",
      spaces.hasPending() ||
        everyday.hasPending() ||
        admin.hasPending() ||
        pending
        ? "A pending action may already have been saved. Signing out discards this tab's retry state and unsaved drafts; review saved state after signing in again."
        : "Signing out discards this unsaved draft.",
      "Discard changes",
      "Keep editing",
    ))
  )
    return;
  setBusy(true);
  try {
    await api.request("/auth/logout", {});
    authenticated = false;
    api.csrf = "";
    editor = undefined;
    pending = undefined;
    tasks = [];
    everyday.reset();
    admin.reset();
    spaces.reset();
    api.space = "personal";
    lastIdentity = "";
    window.google?.accounts.id.disableAutoSelect();
    await signInView();
  } catch (error) {
    if (error instanceof ContextChanged) return;
    if (needsLogin(error)) {
      authenticated = false;
      editor = undefined;
      pending = undefined;
      tasks = [];
      everyday.reset();
      spaces.reset();
      api.space = "personal";
      lastIdentity = "";
      await signInView();
    } else {
      announce("Sign-out could not be confirmed. Try again.");
      show("save-error", !!editor);
      show("list-error", !editor);
      get(editor ? "save-error" : "list-error").querySelector(
        "p",
      )!.textContent =
        "Sign-out could not be confirmed. Please try signing out again.";
    }
  } finally {
    setBusy(false);
  }
});
window.addEventListener("beforeunload", (event) => {
  if (
    dirty() ||
    everyday.dirty() ||
    spaces.dirty() ||
    spaces.hasPending() ||
    busy
  )
    event.preventDefault();
});
const everyday = new Everyday(get("everyday-view"), api, {
  show: () => view("everyday"),
  tasks: () => {
    everyday.reset();
    void loadTasks();
  },
  copy: (source) => void spaces.startCopy(source),
  busy: setBusy,
  expired,
  confirm,
  announce,
});
get("storage-recovery").addEventListener("click", () => {
  if (!busy && recoveryTaskId) void everyday.storageRecovery(recoveryTaskId);
});
function clearContent() {
  recoveryTaskId = "";
  show("storage-recovery", false);
  tasks = [];
  editor = undefined;
  pending = undefined;
  everyday.reset();
  admin.reset();
  get("open-tasks").replaceChildren();
  get("completed-tasks").replaceChildren();
  get<HTMLInputElement>("title").value = "";
  get<HTMLTextAreaElement>("notes").value = "";
}
async function prepareNavigation() {
  if (busy) return false;
  if (
    pending ||
    everyday.hasPending() ||
    spaces.hasPending() ||
    admin.hasPending()
  ) {
    announce(
      "Finish retrying the pending action before changing spaces or leaving this workflow.",
    );
    return false;
  }
  if (
    (dirty() || spaces.dirty() || admin.dirty()) &&
    !(await confirm(
      "Discard your changes?",
      "Your unsaved changes will be lost.",
      "Discard changes",
      "Keep editing",
    ))
  )
    return false;
  if (!(await everyday.leave())) return false;
  editor = undefined;
  pending = undefined;
  everyday.reset();
  spaces.discardDraft();
  admin.discardDraft();
  admin.active = false;
  return true;
}
const spaces = new Households(
  get("household-view"),
  get("space-controls"),
  api,
  {
    show: () => view("household"),
    prepare: prepareNavigation,
    clearContent,
    invitationArrived: async () => {
      if (api.normalAccounts) {
        if (!(await prepareNavigation())) return;
        onboarding.setToken(spaces.takeInvitation());
        clearContent();
        spaces.reset();
        authenticated = false;
        await signInView();
        return;
      }
      if (!authenticated || !(await prepareNavigation())) return;
      setBusy(true);
      try {
        await spaces.openInvitation();
      } finally {
        setBusy(false);
      }
    },
    openCopy: async (space, id) => {
      clearContent();
      spaces.discardDraft();
      api.space = space;
      await loadTasks();
      if (api.space === space) await everyday.openCollection(id);
    },
    enterSpace: async (id) => {
      clearContent();
      spaces.discardDraft();
      api.space = id;
      await loadTasks();
    },
    switchSpace: async (id) => {
      if (!(await prepareNavigation())) return false;
      clearContent();
      api.space = id;
      await loadTasks();
      return true;
    },
    busy: setBusy,
    // Newly rendered controls inherit the current in-flight state.
    syncBusyControls: () => setBusy(busy),
    expired,
    confirm,
  },
);
const onboarding = new Onboarding(get("onboarding-view"), api, {
  show: () => view("onboarding"),
  busy: setBusy,
  signIn: signInView,
  complete: async (id) => {
    clearContent();
    spaces.reset();
    onboarding.reset();
    api.space = id;
    authenticated = true;
    await loadTasks();
  },
});
const admin = new Administration(get("admin-view"), api, {
  confirm,
  show: () => view("admin"),
  prepare: prepareNavigation,
  busy: setBusy,
  expired,
  sync: () => setBusy(busy),
});
get("nav-admin").addEventListener("click", () => void admin.open());
api.accessEnded = () => {
  clearContent();
  spaces.reset();
  status(
    "Household access ended",
    "Household content and drafts have been cleared. Your personal sign-in remains available.",
  );
  text("retry-load", "Open personal space");
  show("retry-load", true);
  announce(
    "Household access ended. Household content and drafts have been cleared.",
  );
};
async function navigateEveryday(
  kind: "shopping" | "checklists" | "archive" | "trash",
) {
  if (!(await prepareNavigation())) return;
  await everyday.open(kind);
}
get("nav-archive").addEventListener(
  "click",
  () => void navigateEveryday("archive"),
);
get("nav-trash").addEventListener(
  "click",
  () => void navigateEveryday("trash"),
);
get("nav-checklists").addEventListener(
  "click",
  () => void navigateEveryday("checklists"),
);
get("nav-shopping").addEventListener(
  "click",
  () => void navigateEveryday("shopping"),
);
get("nav-tasks").addEventListener("click", async () => {
  if (!(await prepareNavigation())) return;
  await loadTasks();
});
void loadTasks();
