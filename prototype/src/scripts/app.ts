import { characterCount, orderedTasks, saveDraft, seedTasks, validateDraft } from "../lib/model";
import type { Draft, FieldErrors, Task } from "../lib/model";

type View = "signed-out" | "denied" | "loading" | "load-error" | "list" | "new" | "edit";
type Failure = "success" | "failure" | "lost-response";
interface Editor { draft: Draft; original: Draft; mode: "new" | "edit" }

const app = document.querySelector<HTMLElement>("#app")!;
const dialog = document.querySelector<HTMLDialogElement>("#confirmation")!;
const live = document.querySelector<HTMLElement>("#announcement")!;
const googleMark = app.dataset.googleMark!;
const scenario = document.querySelector<HTMLSelectElement>("#scenario")!;
const nextAction = document.querySelector<HTMLSelectElement>("#next-action")!;
const latency = document.querySelector<HTMLSelectElement>("#latency")!;
const cancelSignin = document.querySelector<HTMLInputElement>("#cancel-signin")!;

let serverTasks = seedTasks();
let tasks = structuredClone(serverTasks);
let view: View = "signed-out";
let signedIn = false;
let busy = false;
let editor: Editor | null = null;
let suspendedEditor: Editor | null = null;
let fieldErrors: FieldErrors = {};
let message = "";
let saveError = false;
let pendingTask: string | null = null;
let rowError: { id: string; message: string; retry: () => void } | null = null;
let confirmation: (() => void) | null = null;
let returnFocus: HTMLElement | null = null;

const escape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const icons: Record<string, string> = {
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="m14 6-6 6 6 6M8 12h12"/>',
  list: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v.1"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
};
const icon = (name: string): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const spinner = '<span class="spinner small" aria-hidden="true"></span>';
const disabled = (): string => busy ? "disabled" : "";
const button = (text: string, action: string, style = "", symbol = ""): string => `<button type="button" class="button ${style}" data-action="${action}" ${disabled()}>${symbol ? icon(symbol) : ""}${text}</button>`;
const header = (): string => `<header class="app-header"><div class="brand"><span class="brand-symbol">${icon("check")}</span>intrepion</div><span class="personal">Personal list</span></header>`;
const account = (): string => `<footer class="account-bar"><div class="account-label"><span class="avatar">O</span><span>owner@example.invalid</span></div><button type="button" class="quiet" data-action="signout" ${disabled()}>Sign out</button></footer>`;
const dirty = (): boolean => {
  const draft = editor ?? suspendedEditor;
  return draft !== null && (draft.draft.title !== draft.original.title || draft.draft.notes !== draft.original.notes);
};
const pause = (): Promise<void> => new Promise(resolve => setTimeout(resolve, Number(latency.value)));

function announce(text: string): void { live.textContent = text; }
function inspect(): void {
  const currentDraft = editor ?? suspendedEditor;
  const details = [
    `Screen: ${view}`, `Signed in: ${signedIn ? "yes (simulated owner)" : "no"}`,
    `Waiting for a response: ${busy ? "yes" : "no"}`, `Unsaved draft: ${dirty() ? "yes" : "no"}`,
    `Next task action: ${nextAction.selectedOptions[0]?.textContent ?? "Succeeds"}`,
    `Visible tasks: ${tasks.length}; simulated saved tasks: ${serverTasks.length}`,
    ...orderedTasks(tasks).flatMap(task => [`• ${task.completed ? "Complete" : "Open"}: ${task.title}`, ...(task.notes ? [`  Notes: ${task.notes}`] : [])]),
    ...(currentDraft ? [`Draft title: ${currentDraft.draft.title}`, `Draft notes: ${currentDraft.draft.notes}`] : []),
  ];
  document.querySelector<HTMLElement>("#state-inspector")!.textContent = details.join("\n");
  document.querySelector<HTMLButtonElement>("#finish-loading")!.hidden = view !== "loading" || busy;
  for (const control of document.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>(".review-tools button, .review-tools select, .review-tools input")) control.disabled = busy;
}

function taskRow(task: Task): string {
  const pending = pendingTask === task.id;
  const error = rowError?.id === task.id;
  return `<article class="task" data-task-id="${escape(task.id)}"><button type="button" class="task-check" role="checkbox" aria-checked="${task.completed}" aria-label="${task.completed ? "Reopen" : "Complete"} task: ${escape(task.title)}" data-action="toggle" data-id="${escape(task.id)}" ${disabled()}><span class="check-mark${task.completed ? " checked" : ""}">${task.completed ? icon("check") : ""}</span></button><div class="task-copy"><div class="task-title${task.completed ? " completed" : ""}">${escape(task.title)}</div>${task.notes ? `<p class="task-notes">${escape(task.notes)}</p>` : ""}${pending ? `<div class="row-message">${spinner}Saving…</div>` : ""}${error ? `<div class="row-message error" role="alert"><span>${escape(rowError!.message)}</span><button type="button" class="quiet" data-action="retry-row" ${disabled()}>Try again</button></div>` : ""}</div><div class="task-actions"><button type="button" class="quiet" data-action="edit" data-id="${escape(task.id)}" aria-label="Edit task: ${escape(task.title)}" ${disabled()}>Edit</button><button type="button" class="quiet destructive" data-action="delete" data-id="${escape(task.id)}" aria-label="Delete task: ${escape(task.title)}" ${disabled()}>Delete</button></div></article>`;
}

function listMarkup(): string {
  const ordered = orderedTasks(tasks);
  const open = ordered.filter(task => !task.completed);
  const completed = ordered.filter(task => task.completed);
  return `<section class="page-content"><div class="heading-row"><div><h1 tabindex="-1" id="page-title">Tasks</h1>${tasks.length ? `<p class="subtitle">${open.length} open</p>` : ""}</div>${button("New task", "new", "primary", "plus")}</div>${tasks.length ? `${open.map(taskRow).join("")}<h2 class="completed-heading">Completed <span class="badge">${completed.length}</span></h2>${completed.map(taskRow).join("")}` : `<div class="center-state"><div class="state-icon">${icon("list")}</div><h2>No tasks yet.</h2><p>Add something you want to get done.</p></div>`}</section>${account()}`;
}

function formMarkup(): string {
  const current = editor!;
  const draft = current.draft;
  const create = current.mode === "new";
  return `<section class="page-content"><div class="editor"><button type="button" class="quiet back-button" data-action="back" ${disabled()}>${icon("back")}Back to tasks</button><h1 tabindex="-1" id="page-title">${create ? "New task" : "Edit task"}</h1><p class="editor-description">${create ? "Start with a title. Add details if you need them." : "A small change, a clearer next step."}</p>${saveError ? `<div class="notice" role="alert">${icon("alert")}<div><strong>We couldn’t confirm your save.</strong>Your text is still here. Try saving again.</div></div>` : ""}<form id="task-form" novalidate><div class="label-line"><label for="task-title">Title</label><span class="counter" id="title-counter">${characterCount(draft.title)} / 200</span></div><input id="task-title" name="title" value="${escape(draft.title)}" placeholder="What needs doing?" aria-describedby="title-hint title-counter" aria-invalid="${Boolean(fieldErrors.title)}" ${disabled()}><p id="title-hint" class="hint${fieldErrors.title ? " error" : ""}">${escape(fieldErrors.title ?? "Required")}</p><div class="label-line"><label for="task-notes">Notes <span class="optional">(optional)</span></label><span class="counter" id="notes-counter">${characterCount(draft.notes)} / 10,000</span></div><textarea id="task-notes" name="notes" aria-describedby="notes-hint notes-counter" aria-invalid="${Boolean(fieldErrors.notes)}" ${disabled()}>${escape(draft.notes)}</textarea><p id="notes-hint" class="hint${fieldErrors.notes ? " error" : ""}">${escape(fieldErrors.notes ?? "Plain text. A little context for later.")}</p><div class="form-actions">${button("Cancel", "back")}<button type="submit" class="button primary" ${disabled()}>${busy ? `${spinner}Saving…` : saveError ? "Try saving again" : create ? "Save task" : "Save changes"}</button></div></form></div></section>`;
}

function stateMarkup(): string {
  if (view === "signed-out" || view === "denied") {
    const denied = view === "denied";
    return `<section class="center-state"><div class="state-icon">${icon(denied ? "lock" : "list")}</div><h1 tabindex="-1" id="page-title">${denied ? "This account doesn’t have access." : "Your list, in one place."}</h1><p>${denied ? "Try signing in with your approved Google account." : "Sign in to view and manage your tasks."}</p>${message ? `<div class="notice" role="alert">${escape(message)}</div>` : ""}<button type="button" class="google-button" data-action="signin" ${disabled()}><img src="${googleMark}" alt="" width="20" height="20">Continue with Google</button><p class="footnote">${denied ? "Choose another Google account to continue." : "Access is limited to the owner."}</p></section>`;
  }
  const failed = view === "load-error";
  return `<section class="page-content"><div class="heading-row"><h1 tabindex="-1" id="page-title">Tasks</h1></div><div class="center-state"><div class="state-icon">${failed ? icon("alert") : '<span class="spinner" aria-hidden="true"></span>'}</div><h2>${failed ? "Couldn’t load your tasks." : "Opening your list…"}</h2><p>${failed ? "Check your connection and try again." : "This can take about a minute after a period of inactivity."}</p>${failed ? button("Retry", "reload", "primary") : ""}</div></section>${failed ? account() : ""}`;
}

function render(focus?: string): void {
  app.setAttribute("aria-busy", String(busy));
  app.innerHTML = header() + (view === "list" ? listMarkup() : view === "new" || view === "edit" ? formMarkup() : stateMarkup());
  document.title = `${view === "new" ? "New task" : view === "edit" ? "Edit task" : "Tasks"} · local prototype`;
  inspect();
  if (focus) requestAnimationFrame(() => app.querySelector<HTMLElement>(focus)?.focus());
}

function closeConfirmation(): void {
  confirmation = null;
  dialog.close();
  if (returnFocus?.isConnected) returnFocus.focus();
}

function confirmAction(kind: "discard" | "delete", action: () => void, title = ""): void {
  if (dialog.open) return;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  confirmation = action;
  const discard = kind === "discard";
  dialog.innerHTML = `<div class="state-icon${discard ? "" : " red"}">${icon(discard ? "back" : "trash")}</div><h2 id="confirmation-title">${discard ? "Discard your changes?" : "Delete this task?"}</h2>${discard ? "" : `<div class="task-reference">${escape(title)}</div>`}<p id="confirmation-description">${discard ? "Your unsaved edits will be lost." : "This permanently deletes the task."}</p><div class="form-actions"><button type="button" class="button" id="confirmation-cancel" autofocus>${discard ? "Keep editing" : "Cancel"}</button><button type="button" class="button${discard ? "" : " destructive"}" id="confirmation-accept">${discard ? "Discard changes" : "Delete task"}</button></div>`;
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>("#confirmation-cancel")!.focus();
}

function navigate(action: () => void): void {
  if (busy) return;
  if (dirty()) confirmAction("discard", action);
  else action();
}

function showList(): void {
  editor = null; fieldErrors = {}; saveError = false; message = ""; view = "list";
  render("#page-title");
}

function openEditor(task?: Task): void {
  const draft = task ? { id: task.id, title: task.title, notes: task.notes } : { id: crypto.randomUUID(), title: "", notes: "" };
  editor = { draft, original: { ...draft }, mode: task ? "edit" : "new" };
  fieldErrors = {}; saveError = false; rowError = null; view = task ? "edit" : "new";
  render("#task-title");
}

async function signIn(): Promise<void> {
  if (busy) return;
  if (cancelSignin.checked) {
    cancelSignin.checked = false; view = "signed-out"; message = "Sign-in was cancelled. Try again.";
    render('[data-action="signin"]'); return;
  }
  busy = true; view = "loading"; message = ""; render();
  await pause();
  signedIn = true; busy = false; tasks = structuredClone(serverTasks);
  if (suspendedEditor) {
    editor = suspendedEditor; suspendedEditor = null; view = editor.mode;
    render("#task-title"); announce("Signed back in. Your draft is still here.");
  } else showList();
}

function signOut(): void {
  navigate(() => {
    signedIn = false; view = "signed-out"; editor = null; suspendedEditor = null; rowError = null; message = "";
    render('[data-action="signin"]'); announce("Signed out.");
  });
}

async function mutate(effect: () => void, success: () => void, failure: () => void): Promise<void> {
  if (busy) return;
  const fault = nextAction.value as Failure;
  nextAction.value = "success";
  busy = true; render();
  await pause();
  if (fault !== "failure") effect();
  busy = false;
  if (fault === "success") { tasks = structuredClone(serverTasks); success(); }
  else failure();
  inspect();
}

async function submitDraft(): Promise<void> {
  if (!editor || busy) return;
  fieldErrors = validateDraft(editor.draft);
  if (Object.keys(fieldErrors).length) {
    render(fieldErrors.title ? "#task-title" : "#task-notes"); announce("Check the highlighted fields."); return;
  }
  const draft = { ...editor.draft };
  await mutate(
    () => { serverTasks = saveDraft(serverTasks, draft); },
    () => { showList(); announce("Task saved."); },
    () => { saveError = true; render("#task-title"); announce("Save could not be confirmed. Your draft is still here."); },
  );
}

async function toggleTask(task: Task): Promise<void> {
  const desired = !task.completed;
  rowError = null; pendingTask = task.id;
  await mutate(
    () => { serverTasks = serverTasks.map(saved => saved.id === task.id ? { ...saved, completed: desired } : saved); },
    () => { pendingTask = null; render("#page-title"); announce(desired ? "Task completed." : "Task reopened."); },
    () => { pendingTask = null; rowError = { id: task.id, message: "Couldn’t update this task.", retry: () => { void toggleTask(task); } }; render('[data-action="retry-row"]'); announce("Task update could not be confirmed."); },
  );
}

async function deleteTask(task: Task): Promise<void> {
  rowError = null; pendingTask = task.id;
  await mutate(
    () => { serverTasks = serverTasks.filter(saved => saved.id !== task.id); },
    () => { pendingTask = null; render("#page-title"); announce("Task deleted."); },
    () => { pendingTask = null; rowError = { id: task.id, message: "Couldn’t delete this task.", retry: () => { void deleteTask(task); } }; render('[data-action="retry-row"]'); announce("Deletion could not be confirmed. The task is still shown."); },
  );
}

function applyScenario(name: string): void {
  if (busy) return;
  const apply = (): void => {
    rowError = null; pendingTask = null; fieldErrors = {}; saveError = false; message = "";
    if (name === "expired") {
      if (editor) suspendedEditor = structuredClone(editor);
      editor = null; signedIn = false; view = "signed-out";
      message = "Your session expired. Sign in again to continue.";
    } else {
      editor = null; suspendedEditor = null;
      if (name === "list" || name === "empty") { serverTasks = name === "empty" ? [] : seedTasks(); tasks = structuredClone(serverTasks); view = "list"; signedIn = true; }
      else { view = name as View; signedIn = name === "loading" || name === "load-error"; }
    }
    render(view === "signed-out" ? '[data-action="signin"]' : "#page-title");
  };
  if (name === "expired") apply(); else navigate(apply);
}

app.addEventListener("click", event => {
  const control = (event.target as Element).closest<HTMLButtonElement>("button[data-action]");
  if (!control || busy) return;
  const task = tasks.find(item => item.id === control.dataset.id);
  switch (control.dataset.action) {
    case "signin": void signIn(); break;
    case "signout": signOut(); break;
    case "new": navigate(() => openEditor()); break;
    case "back": navigate(showList); break;
    case "edit": if (task) navigate(() => openEditor(task)); break;
    case "toggle": if (task) void toggleTask(task); break;
    case "delete": if (task) confirmAction("delete", () => { void deleteTask(task); }, task.title); break;
    case "retry-row": rowError?.retry(); break;
    case "reload": void signIn(); break;
  }
});

app.addEventListener("submit", event => { event.preventDefault(); void submitDraft(); });
app.addEventListener("input", event => {
  if (!editor || busy) return;
  const input = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (input.name !== "title" && input.name !== "notes") return;
  editor.draft[input.name] = input.value;
  document.querySelector<HTMLElement>(`#${input.name}-counter`)!.textContent = `${characterCount(input.value)} / ${input.name === "title" ? "200" : "10,000"}`;
  inspect();
});
dialog.addEventListener("click", event => {
  const id = (event.target as Element).closest<HTMLButtonElement>("button")?.id;
  if (id === "confirmation-cancel") closeConfirmation();
  if (id === "confirmation-accept") {
    const action = confirmation;
    closeConfirmation(); action?.();
  }
});
dialog.addEventListener("cancel", event => { event.preventDefault(); closeConfirmation(); });
window.addEventListener("beforeunload", event => { if (dirty()) event.preventDefault(); });
document.querySelector("#apply-scenario")!.addEventListener("click", () => applyScenario(scenario.value));
document.querySelector("#finish-loading")!.addEventListener("click", () => { signedIn = true; tasks = structuredClone(serverTasks); showList(); });
document.querySelector("#reset-demo")!.addEventListener("click", () => navigate(() => {
  serverTasks = seedTasks(); tasks = structuredClone(serverTasks); editor = null; suspendedEditor = null;
  fieldErrors = {}; rowError = null; pendingTask = null; saveError = false; message = "";
  signedIn = false; view = "signed-out"; nextAction.value = "success"; latency.value = "300"; cancelSignin.checked = false; scenario.value = "signed-out";
  render('[data-action="signin"]'); announce("Demo reset to synthetic sample tasks.");
}));
nextAction.addEventListener("change", inspect);
render();
