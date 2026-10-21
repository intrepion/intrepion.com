import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const directory = new URL("./", import.meta.url);
const css = readFileSync(new URL("mockups.css", directory), "utf8");
const googleLogo = `data:image/png;base64,${readFileSync(new URL("assets/google-g.png", directory)).toString("base64")}`;
const escape = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const paths = {
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="m14 6-6 6 6 6M8 12h12"/>',
  list: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v.1"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
const button = (label, style = "", symbol = "") => `<button type="button" class="button ${style}">${symbol ? icon(symbol) : ""}${label}</button>`;
const brand = `<div class="brand"><span class="brand-mark">${icon("check")}</span>intrepion</div>`;
const top = `<div class="app-top">${brand}<span class="personal-tag">Personal list</span></div>`;
const account = `<div class="account"><div class="account-id"><span class="avatar">O</span><span>owner@example.invalid</span></div><button type="button" class="text-button">Sign out</button></div>`;
const googleButton = `<button type="button" class="google-button"><img src="${googleLogo}" alt="" width="20" height="20">Continue with Google</button>`;
const screen = (body, mobile = false) => `<div class="app-screen${mobile ? " mobile-preview" : ""}">${body}</div>`;

function row(title, notes = "", completed = false, state = "") {
  return `<div class="task-row"><button type="button" class="check-control" aria-label="${completed ? "Reopen" : "Complete"} task: ${escape(title)}"><span class="check-box${completed ? " checked" : ""}">${completed ? icon("check") : ""}</span></button><div class="task-text"><div class="task-title${completed ? " done" : ""}">${escape(title)}</div>${notes ? `<p class="snippet">${escape(notes)}</p>` : ""}${state === "pending" ? '<div class="muted-message"><span class="loader small"></span>Saving…</div>' : ""}${state === "error" ? '<div class="row-error">Couldn’t update this task.<button type="button" class="text-button">Try again</button></div>' : ""}</div><div class="task-actions"><button type="button" class="text-button" aria-label="Edit task: ${escape(title)}">Edit</button><button type="button" class="text-button danger-text" aria-label="Delete task: ${escape(title)}">Delete</button></div></div>`;
}
function list({ mobile = false, empty = false, state = "" } = {}) {
  const title = `<div class="content-title"><div><h1>Tasks</h1>${empty ? "" : '<p class="subline">2 open</p>'}</div>${button("New task", "primary", "plus")}</div>`;
  const rows = empty
    ? `<div class="center-state"><div class="state-icon">${icon("list")}</div><h2>No tasks yet.</h2><p>Add something you want to get done.</p></div>`
    : `${row("Plan the weekend", "Look up a nearby walking route.", false, state)}${row("Water the plants")}<div class="completed-title">Completed <span class="count">1</span></div>${row("Return library books", "", true)}`;
  return screen(`${top}<div class="content">${title}${rows}</div>${account}`, mobile);
}
function signIn(denied = false) {
  return screen(`${top}<div class="center-state"><div class="state-icon">${icon(denied ? "lock" : "list")}</div><h1>${denied ? "This account doesn’t have access." : "Your list, in one place."}</h1><p>${denied ? "Try signing in with your approved Google account." : "Sign in to view and manage your tasks."}</p>${googleButton}<p class="footnote">${denied ? "Choose another Google account to continue." : "Access is limited to the owner."}</p></div>`);
}
function form({ mobile = false, create = false, error = false, invalid = false, pending = false, suffix = "form" } = {}) {
  const title = create ? "" : error ? "Plan a longer walk" : "Plan the weekend";
  const notes = create ? "" : error ? "Bring water and check the weather." : "Look up a nearby walking route.";
  const titleId = `title-${suffix}`;
  const notesId = `notes-${suffix}`;
  return screen(`${top}<div class="content"><div class="form-content"><div class="back">${icon("back")}Back to tasks</div><h1>${create ? "New task" : "Edit task"}</h1><p class="form-description">${create ? "Start with a title. Add details if you need them." : "A small change, a clearer next step."}</p>${error ? `<div class="banner">${icon("alert")}<div><strong>We couldn’t confirm your save.</strong>Your text is still here. Try saving again.</div></div>` : ""}<div class="label-row"><label for="${titleId}">Title</label><span class="counter">${Array.from(title).length} / 200</span></div><input id="${titleId}" value="${escape(title)}" placeholder="What needs doing?" readonly ${invalid ? 'aria-invalid="true"' : ""} aria-describedby="hint-${suffix}" class="${invalid ? "field-error" : create ? "field-focus" : ""}"><p id="hint-${suffix}" class="field-hint${invalid ? " error" : ""}">${invalid ? `${icon("alert")}Enter a title.` : "Required"}</p><div class="label-row"><label for="${notesId}">Notes <span class="optional">(optional)</span></label><span class="counter">${notes.length} / 10,000</span></div><textarea id="${notesId}" readonly>${escape(notes)}</textarea><p class="field-hint">Plain text. A little context for later.</p><div class="form-actions">${button("Cancel")}${pending ? '<button type="button" class="button pending" disabled><span class="loader small"></span>Saving…</button>' : button(error ? "Try saving again" : create ? "Save task" : "Save changes", "primary")}</div></div></div>`, mobile);
}
function dialog(discard = false) {
  return `<div class="app-screen overlay"><div class="dialog" role="group" aria-label="${discard ? "Discard" : "Delete"} confirmation preview"><div class="state-icon${discard ? "" : " danger-icon"}">${icon(discard ? "back" : "trash")}</div><h2>${discard ? "Discard your changes?" : "Delete this task?"}</h2>${discard ? "" : '<div class="task-reference">Plan the weekend</div>'}<p>${discard ? "Your unsaved edits will be lost." : "This permanently deletes the task."}</p><div class="form-actions">${button(discard ? "Keep editing" : "Cancel", "focus-preview")}${button(discard ? "Discard changes" : "Delete task", discard ? "" : "danger")}</div></div></div>`;
}
function waiting(failed = false) {
  return screen(`${top}<div class="content"><div class="content-title"><h1>Tasks</h1></div><div class="center-state"><div class="state-icon">${failed ? icon("alert") : '<span class="loader"></span>'}</div><h2>${failed ? "Couldn’t load your tasks." : "Opening your list…"}</h2><p>${failed ? "Check your connection and try again." : "This can take about a minute after a period of inactivity."}</p>${failed ? button("Retry", "primary") : ""}</div></div>${failed ? account : ""}`);
}

const boards = [
  ["list", "01", "Your task list", "Desktop", list(), "Task text leads. Completion, Edit, and Delete are visible; completed tasks keep their own section.", true],
  ["signin", "02", "Google sign-in", "Signed out", signIn(), "A single sign-in option. No task content or owner email is shown before access is granted."],
  ["denied", "03", "Account without access", "Access denied", signIn(true), "The same Google control lets the user choose another account; no registration flow is introduced."],
  ["create", "04", "Create a task", "Focus state", form({ create: true, suffix: "create" }), "Initial focus is on Title. Required and optional fields are explicit; the focus ring is visible."],
  ["edit", "05", "Edit a task", "Desktop", form({ suffix: "edit" }), "Dedicated form view. Save returns to the list after confirmation; Cancel leaves the task unchanged."],
  ["mobile-list", "06", "Tasks on a phone", "390 px", `<div class="mobile-frame">${list({ mobile: true })}</div>`, "Actions move below each task. Touch controls stay at least 44 px tall; text wraps instead of truncating the title."],
  ["mobile-form", "07", "Edit on a phone", "390 px", `<div class="mobile-frame">${form({ mobile: true, suffix: "mobile" })}</div>`, "The same form fits a narrow screen. Footer buttons remain in document flow and do not cover fields."],
  ["empty", "08", "A fresh list", "Empty state", list({ empty: true }), "The header keeps the one New task action. Empty is shown only after a successful load."],
  ["loading", "09", "Opening the list", "Extended loading", waiting(), "The longer-delay explanation appears only when useful. The loading ring is static in these mockups."],
  ["delete", "10", "Permanent deletion", "Confirmation", dialog(), "A distinct destructive action; Cancel receives initial keyboard focus. The tinted backdrop indicates a modal."],
  ["discard", "11", "Leave an unsaved draft", "Confirmation", dialog(true), "Keep editing is the safe initial action. This dialog applies to Back, Cancel, navigation, or sign-out with changes."],
  ["save-error", "12", "Save not confirmed", "Draft retained", form({ error: true, suffix: "save-error" }), "No premature success state. Preserve text and retry using the same task identity."],
  ["load-error", "13", "List unavailable", "Retry", waiting(true), "A service error is distinct from denied access. The app offers Retry and Sign out, without offline editing."],
  ["validation", "14", "Title validation", "Invalid input", form({ create: true, invalid: true, suffix: "invalid" }), "Error text and an icon supplement the red border. The field keeps its label and character limit."],
  ["saving", "15", "Save in progress", "Pending state", form({ pending: true, suffix: "saving" }), "Retain the draft, show Saving…, and prevent duplicate submits while the request is pending."],
  ["row-error", "16", "Task update failed", "Confirmed state retained", list({ state: "error" }), "An unsuccessful completion stays open and gets a local retry message. Other task data remains visible."],
  ["row-pending", "17", "Task update in progress", "Pending completion", list({ state: "pending" }), "Keep the last confirmed checkbox state while waiting. The prototype will disable repeated actions on that task."],
];

function document(title, body, classes = "") {
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${css}</style></head><body class="${classes}">${body}</body></html>\n`;
}
const intro = `<header class="review-header"><div class="eyebrow">Design gate 2 · Visual mockups · Awaiting owner review</div><h1>Room for the next thing.</h1><p>A quiet task interface, with warm surfaces, deep teal actions, and readable text. These visual mockups follow the approved wireframes. Controls are static; no login, task mutation, storage, or network requests occur.</p><nav class="review-links" aria-label="Mockup navigation">${boards.map(([id, number, title]) => `<a href="#${id}">${number} ${title}</a>`).join("")}</nav></header>`;
const gallery = boards.map(([id, number, title, context, content, note, wide]) => `<section class="board${wide ? " wide" : ""}" id="${id}"><div class="board-title"><h2>${number} · ${title}</h2><span>${context}</span></div>${content}<p class="board-note">${note}</p></section>`).join("");
const swatches = [["Canvas", "#f4f5f1"], ["Surface", "#ffffff"], ["Text", "#1b302c"], ["Secondary text", "#596b65"], ["Primary action", "#185e52"], ["Destructive", "#a52f2b"]];
const tokens = `<section class="board wide tokens"><h2>The visual system</h2><p>System fonts; 30 px desktop headings, 15–16 px body text, 12–14 px supporting text. Spacing follows a 4 px rhythm. Controls use 8–9 px corners, surfaces 18 px corners, and a 3 px visible focus outline. No custom font downloads or decorative imagery.</p><div class="swatches">${swatches.map(([label, color]) => `<div><div class="swatch-color" style="background:${color}"></div><div class="swatch-label">${label}<br>${color}</div></div>`).join("")}</div><p>Google’s sign-in mark is the official local asset. The prototype will simulate sign-in; production branding and the real identity control will be checked during Google integration. No task details or identity shown here are real.</p><p>Approval covers visual treatment, spacing, typography, control appearance, and error/pending presentation. Keyboard behavior, real responsive interaction, focus restoration, and timing are evaluated in the separate Astro prototype after approval.</p></section>`;

const output = {
  "mockups.html": document("MVP 1 — visual mockups", `${intro}<main class="gallery">${gallery}${tokens}</main>`),
  "mockup-desktop.html": document("Tasks — desktop mockup", list(), "single-page"),
  "mockup-mobile.html": document("Tasks — mobile mockup", list({ mobile: true }), "mobile-page"),
  "mockup-form.html": document("Edit task — desktop mockup", form({ suffix: "standalone" }), "single-page"),
  "mockup-mobile-form.html": document("Edit task — mobile mockup", form({ mobile: true, suffix: "standalone-mobile" }), "mobile-page"),
  "mockup-states.html": document("Confirmation and error states — mockups", `<header class="review-header"><div class="eyebrow">MVP 1 · Static visual mockups</div><h1>Confirmation and recovery.</h1><p>Clear choices, retained drafts, and errors close to the action.</p></header><main class="gallery">${boards.filter(([id]) => ["delete", "discard", "save-error", "validation"].includes(id)).map(([id, number, title, context, content, note]) => `<section class="board" id="${id}"><div class="board-title"><h2>${number} · ${title}</h2><span>${context}</span></div>${content}<p class="board-note">${note}</p></section>`).join("")}</main>`),
};
for (const [name, content] of Object.entries(output)) {
  writeFileSync(new URL(name, directory), content);
}
console.log(`Rendered ${Object.keys(output).length} standalone mockup documents in ${fileURLToPath(directory)}`);
