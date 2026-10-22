import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { TaskSchema, type Task } from "../gen/life/v1/tasks_pb";
import { Everyday } from "./everyday";
import { Api, HttpError, needsLogin } from "../lib/api";
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
function focus(id: string) {
  get(id).focus();
}
const api = new Api(get("app").dataset.apiOrigin!);
let tasks: Task[] = [];
let authenticated = false;
let busy = false;
let config: { google_client_id: string; development: boolean };
type Editor = { id: string; original?: Task; fields: Fields };
let editor: Editor | undefined;
type Action =
  | { kind: "create" | "update"; task: Task }
  | { kind: "delete"; id: string; revision: number };
let pending: Action | undefined;
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
function view(name: "status" | "list" | "editor" | "everyday") {
  for (const candidate of ["status", "list", "editor", "everyday"])
    show(`${candidate}-view`, candidate === name);
  show("account", authenticated);
  show("main-nav", authenticated);
}
function status(title: string, description: string, loading = false) {
  view("status");
  text("status-title", title);
  text("status-description", description);
  get("status-view").querySelector<HTMLElement>(".spinner")!.hidden = !loading;
  show("google-button", false);
  show("development-login", false);
  show("retry-load", !loading);
}
function errorMessage(error: unknown): string {
  if (error instanceof ConnectError && error.code === Code.FailedPrecondition)
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
  actions.append(edit, history, remove);
  article.append(toggle, copy, actions);
  return article;
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
    if (needsLogin(error)) {
      expired();
    } else {
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
    await api.session();
    authenticated = true;
    tasks = ordered(
      (await api.tasks.listTasks({}, { timeoutMs: 90000 })).tasks,
    );
    if (everyday.active) {
      everyday.resume();
    } else if (editor) {
      renderEditor();
      focus("title");
    } else {
      renderList();
    }
  } catch (error) {
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
    config = await api.request("/auth/config");
    const { nonce } = await api.request<{ nonce: string }>(
      "/auth/challenge",
      {},
    );
    if (config.development) {
      show("development-login", true);
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
async function authenticate(path: string, nonce: string, credential = "") {
  if (busy) return;
  setBusy(true);
  try {
    await api.login(path, nonce, credential);
    authenticated = true;
    await loadTasks();
  } catch (error) {
    const accessDenied = error instanceof HttpError && error.status === 403;
    status(
      accessDenied
        ? "This account does not have access"
        : "Sign-in could not be completed",
      accessDenied
        ? "Try signing in with your approved Google account."
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
    (dirty() || everyday.dirty()) &&
    !(await confirm(
      "Discard your changes?",
      "Signing out discards this unsaved draft.",
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
    window.google?.accounts.id.disableAutoSelect();
    await signInView();
  } catch (error) {
    if (needsLogin(error)) {
      authenticated = false;
      editor = undefined;
      pending = undefined;
      tasks = [];
      everyday.reset();
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
  if (dirty() || everyday.dirty() || busy) event.preventDefault();
});
const everyday = new Everyday(get("everyday-view"), api, {
  show: () => view("everyday"),
  busy: setBusy,
  expired,
  confirm,
  announce,
});
async function navigateEveryday(
  kind: "shopping" | "checklists" | "archive" | "trash",
) {
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
  if (!(await everyday.leave())) return;
  editor = undefined;
  pending = undefined;
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
  if (busy || !(await everyday.leave())) return;
  everyday.reset();
  await leaveEditor();
});
void loadTasks();
