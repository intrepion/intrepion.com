// Throwaway MVP 2 interaction review. Never import into production /web.
import {
  baseCollection,
  baseItem,
  change,
  collectionValues,
  copy,
  initialState,
  uid,
} from "../lib/everyday-demo";
import type {
  Collection,
  DemoItem,
  DemoState,
  Kind,
} from "../lib/everyday-demo";

type Area = Kind | "archive" | "trash";
type Draft = {
  title: string;
  notes: string;
  quantity: string;
  section: string;
};
type Editor = {
  mode: "collection" | "item" | "section" | "start";
  parent: string;
  target: string;
  kind: Kind;
  draft: Draft;
  original: string;
  revision: number;
};
type Operation = {
  id: string;
  label: string;
  parent: string;
  revision: number;
  readOnlyParent?: boolean;
  apply: (state: DemoState) => void;
  done?: () => void;
};
const app = document.querySelector<HTMLElement>("#everyday-app")!;
const dialog = document.querySelector<HTMLDialogElement>("#everyday-dialog")!;
const announcer = document.querySelector<HTMLElement>("#announcement")!;
const inspector = document.querySelector<HTMLElement>("#state-inspector")!;
const nextResult = document.querySelector<HTMLSelectElement>("#next-result")!;
const delaySelect = document.querySelector<HTMLSelectElement>("#delay")!;
const scenario = document.querySelector<HTMLSelectElement>("#scenario")!;
const googleMark = app.dataset.googleMark!;
let server = initialState();
let visible = copy(server);
const applied = new Set<string>();
let area: Area = "shopping";
let selected = "";
let detailMode: "detail" | "history" | "organize" = "detail";
let runFilter = "active";
let signedIn = false;
let denied = false;
let screen: "normal" | "loading" | "unavailable" = "normal";
let editor: Editor | null = null;
let errors: Record<string, string> = {};
let busy = false;
let pending: Operation | null = null;
let errorMessage = "";
let conflict = false;
let message = "";
let historyLimit = 12;
let modalAction: (() => void) | null = null;
let modalReturn: HTMLElement | null = null;

const escape = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const count = (value: string) => [...value].length;
const labels: Record<Area, string> = {
  task: "Tasks",
  shopping: "Shopping",
  template: "Templates",
  run: "Runs",
  archive: "Archive",
  trash: "Trash",
};
const singular: Record<Kind, string> = {
  task: "task",
  shopping: "shopping list",
  template: "template",
  run: "run",
};
const current = () => visible.collections.find((c) => c.id === selected);
const readonly = (c: Collection) =>
  c.trashed || c.archived || (c.kind === "run" && c.finished);
const activeItems = (c: Collection) => c.items.filter((i) => !i.trashed);
const dirty = () =>
  Boolean(editor && JSON.stringify(editor.draft) !== editor.original);
const itemById = (c: Collection, id: string) =>
  c.items.find((i) => i.id === id)!;
const serverCollection = (s: DemoState, id: string) =>
  s.collections.find((c) => c.id === id)!;
const formatDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const icon = (name = "check") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${name === "back" ? '<path d="m12 5-7 7 7 7M5 12h15"/>' : name === "plus" ? '<path d="M12 5v14M5 12h14"/>' : name === "list" ? '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/>' : '<path d="m5 12 4 4L19 6"/>'}</svg>`;
function btn(
  label: string,
  action: string,
  id = "",
  style = "",
  disabled = false,
  extra = "",
): string {
  return `<button type="button" data-action="${action}" data-id="${escape(id)}" class="${style}"${busy || disabled ? " disabled" : ""}${extra}>${escape(label)}</button>`;
}
const quiet = (label: string, action: string, id = "", disabled = false) =>
  btn(
    label,
    action,
    id,
    `quiet${label === "Move to Trash" || label.includes("Erase") ? " destructive" : ""}`,
    disabled,
  );
const badge = (text: string, neutral = false) =>
  `<span class="badge${neutral ? " neutral" : ""}">${escape(text)}</span>`;
const heading = (title: string, subtitle = "", action = "") =>
  `<div class="heading"><div><h1 id="page-title" tabindex="-1">${escape(title)}</h1>${subtitle ? `<p class="subtitle">${escape(subtitle)}</p>` : ""}</div>${action}</div>`;
const notice = (title: string, text = "", error = false) =>
  `<div class="notice${error ? " error" : ""}"${error ? ' role="alert"' : ""}><div><strong>${escape(title)}</strong>${escape(text)}</div></div>`;
const back = (label: string, action = "back") =>
  `<div class="back">${quiet(`← ${label}`, action)}</div>`;
const empty = (title: string, text: string, action = "") =>
  `<div class="empty"><div class="empty-icon">${icon("list")}</div><h2>${escape(title)}</h2><p>${escape(text)}</p>${action}</div>`;
const newLabel = () =>
  area === "task"
    ? "New task"
    : area === "shopping"
      ? "New shopping list"
      : "New template";
const tabs = (entries: [string, string][], active: string) =>
  `<div class="tabs">${entries.map(([key, title]) => btn(title, "area", key, "", false, ` aria-pressed="${active === key}"`)).join("")}</div>`;
function header(): string {
  return `<header class="app-top"><div class="brand"><span class="brand-mark">${icon()}</span>intrepion</div><span class="personal">Everyday lists</span></header>${signedIn ? `<nav aria-label="Main navigation">${(["task", "shopping", "template"] as const).map((key) => btn(key === "template" ? "Checklists" : labels[key], "area", key, "", false, area === key || (key === "template" && area === "run") ? ' aria-current="page"' : "")).join("")}</nav>` : ""}`;
}
function footer(): string {
  return `<footer class="app-footer"><div class="footer-links">${quiet("Archive", "area", "archive")}${quiet("Trash", "area", "trash")}</div><div class="account"><span class="avatar">O</span><span>Owner</span>${quiet("Sign out", "signout")}</div></footer>`;
}
function inspect(): void {
  inspector.textContent = JSON.stringify(
    {
      signedIn,
      area,
      selected,
      detailMode,
      pending: pending ? { id: pending.id, label: pending.label } : null,
      draft: editor?.draft,
      displayed: visible,
      simulatedSaved: server,
      appliedOperationCount: applied.size,
    },
    null,
    2,
  );
  for (const element of document.querySelectorAll<
    HTMLButtonElement | HTMLSelectElement
  >(".review-tools button,.review-tools select"))
    element.disabled = busy;
}
function row(c: Collection): string {
  const detail =
    c.kind === "shopping"
      ? `${activeItems(c).filter((i) => !i.completed).length} needed · ${activeItems(c).filter((i) => i.completed).length} purchased`
      : c.kind === "template"
        ? `${activeItems(c).length} items · ${c.sections.length} sections`
        : c.kind === "run"
          ? `${activeItems(c).filter((i) => i.completed).length} of ${activeItems(c).length} complete${c.sourceTitle ? ` · From ${c.sourceTitle}` : ""}`
          : c.notes;
  const status = c.trashed
    ? "Trashed"
    : c.archived
      ? "Archived"
      : c.kind === "run"
        ? c.finished
          ? "Finished"
          : "Active"
        : "";
  return `<article class="collection" data-collection-id="${c.id}"><div class="collection-heading"><div><div class="collection-name">${escape(c.title)}</div><p class="collection-note">${escape(detail)}</p></div>${status ? badge(status, status !== "Active") : ""}</div><div class="row-actions">${quiet(c.archived || c.trashed ? "View" : "Open", "open", c.id)}${c.trashed ? quiet("Restore", "restore-parent", c.id) + quiet("Erase permanently", "erase-parent", c.id) : c.archived ? quiet("Unarchive", "unarchive", c.id) + quiet("Move to Trash", "trash-parent", c.id) : (c.kind === "template" ? quiet("Start run", "start", c.id, !activeItems(c).length) : "") + quiet("Archive", "archive", c.id) + quiet("Move to Trash", "trash-parent", c.id)}</div></article>`;
}
function itemRow(c: Collection, item: DemoItem): string {
  const locked = readonly(c);
  const notes = [c.kind === "shopping" ? item.quantity : "", item.notes]
    .filter(Boolean)
    .join(" · ");
  return `<article class="item${c.kind === "template" ? " no-check" : ""}${c.kind === "shopping" && item.completed ? " done" : ""}" data-item-id="${item.id}">${c.kind === "template" ? "" : `<button type="button" class="item-check" data-action="toggle-item" data-id="${item.id}" role="checkbox" aria-checked="${item.completed}" aria-label="${escape(`${c.kind === "shopping" ? (item.completed ? "Mark needed" : "Mark purchased") : item.completed ? "Uncheck" : "Check"}: ${item.title}`)}"${busy || locked ? " disabled" : ""}><span class="check-mark${item.completed ? " checked" : ""}">${item.completed ? icon() : ""}</span></button>`}<div class="item-text"><div class="item-title">${escape(item.title)}</div>${notes ? `<p class="item-notes">${escape(notes)}</p>` : ""}</div>${locked ? "" : `<div class="item-tools">${quiet("Edit", "edit-item", item.id)}${quiet("Move to Trash", "trash-item", item.id)}</div>`}</article>`;
}
function taskRow(c: Collection): string {
  return `<article class="item${c.completed ? " done" : ""}" data-collection-id="${c.id}"><button type="button" class="item-check" data-action="toggle-task" data-id="${c.id}" role="checkbox" aria-checked="${c.completed}" aria-label="${escape(`${c.completed ? "Reopen" : "Complete"} task: ${c.title}`)}"${busy ? " disabled" : ""}><span class="check-mark${c.completed ? " checked" : ""}">${c.completed ? icon() : ""}</span></button><div class="item-text"><div class="item-title">${escape(c.title)}</div><p class="item-notes">${escape(c.notes)}</p></div><div class="item-tools">${quiet("Edit", "edit-parent", c.id)}${quiet("History", "task-history", c.id)}${quiet("Move to Trash", "trash-parent", c.id)}</div></article>`;
}
function indexMarkup(): string {
  let collections = visible.collections.filter(
    (c) => !c.trashed && !c.archived && c.kind === area,
  );
  let contents = "";
  if (area === "trash") {
    const parents = visible.collections.filter((c) => c.trashed);
    const children = visible.collections.flatMap((c) =>
      c.items.filter((i) => i.trashed).map((item) => ({ c, item })),
    );
    contents =
      parents.map(row).join("") +
      children
        .map(
          ({ c, item }) =>
            `<article class="collection"><div class="collection-name">${escape(item.title)}</div><p class="collection-note">Item in ${escape(c.title)}</p>${c.trashed || c.archived || c.finished ? `<p class="hint">${c.trashed ? "Restore" : c.archived ? "Unarchive" : "Reopen"} the parent before restoring this item.</p>` : ""}<div class="row-actions">${quiet("View parent and history", "open", c.id)}${btn("Restore", "restore-item", item.id, "quiet", c.trashed || c.archived || c.finished, ` data-parent="${c.id}"`)}${btn("Erase permanently", "erase-item", item.id, "quiet destructive", false, ` data-parent="${c.id}"`)}</div></article>`,
        )
        .join("");
    if (!contents)
      contents = empty(
        "Trash is empty.",
        "Removed content will appear here until you restore or erase it.",
      );
  } else if (area === "archive") {
    contents =
      visible.collections
        .filter((c) => c.archived && !c.trashed)
        .sort((a, b) => a.title.localeCompare(b.title))
        .map(row)
        .join("") ||
      empty(
        "Nothing archived.",
        "Keep collections here when you no longer need them in active views.",
      );
  } else if (area === "task") {
    collections.sort((a, b) => b.created - a.created);
    contents =
      collections
        .filter((c) => !c.completed)
        .map(taskRow)
        .join("") +
      (collections.length
        ? `<div class="section-heading"><h2>Completed · ${collections.filter((c) => c.completed).length}</h2></div>${collections
            .filter((c) => c.completed)
            .map(taskRow)
            .join("")}`
        : empty("No tasks yet.", "Add something you want to get done."));
  } else {
    if (area === "run")
      collections = collections
        .filter((c) => c.finished === (runFilter === "finished"))
        .sort((a, b) => b.created - a.created);
    else collections.sort((a, b) => a.title.localeCompare(b.title));
    contents =
      collections.map(row).join("") ||
      empty(
        area === "run"
          ? `No ${runFilter} runs.`
          : area === "template"
            ? "No templates yet."
            : "No shopping lists yet.",
        area === "run"
          ? "Choose a template to start a fresh run."
          : "Create one to get started.",
        area === "run"
          ? btn("View templates", "area", "template", "primary")
          : "",
      );
  }
  const subnav =
    area === "template" || area === "run"
      ? tabs(
          [
            ["template", "Templates"],
            ["run", "Runs"],
          ],
          area,
        )
      : "";
  return `${heading(labels[area], area === "trash" ? "Removed content stays here until you erase it." : area === "archive" ? "Read-only collections. Unarchive to use them again." : "", area === "shopping" || area === "template" || area === "task" ? btn(newLabel(), "new-parent", "", "primary") : "")}${subnav}${area === "run" ? `<div class="tabs secondary">${btn("Active", "filter", "active", "", false, ` aria-pressed="${runFilter === "active"}"`)}${btn("Finished", "filter", "finished", "", false, ` aria-pressed="${runFilter === "finished"}"`)}</div>` : ""}${contents}`;
}
function collectionControls(c: Collection): string {
  if (c.trashed)
    return `<div class="toolbar">${btn("History", "history")}${btn("Restore", "restore-parent", c.id)}${btn("Erase permanently", "erase-parent", c.id, "danger")}</div>`;
  if (c.archived)
    return `<div class="toolbar">${btn("History", "history")}${btn("Unarchive", "unarchive", c.id)}${btn("Move to Trash", "trash-parent", c.id)}</div>`;
  return `<div class="toolbar">${!c.finished ? btn("Edit details", "edit-parent", c.id) : ""}${btn("History", "history")}${c.finished ? btn("Reopen run", "reopen", c.id) : ""}${c.kind !== "task" ? btn("Archive", "archive", c.id) : ""}${btn("Move to Trash", "trash-parent", c.id)}</div>`;
}
function detailMarkup(c: Collection): string {
  const locked = readonly(c);
  const items = activeItems(c);
  const status = c.trashed
    ? "Trashed · Read-only"
    : c.archived
      ? "Archived · Read-only"
      : c.kind === "run"
        ? c.finished
          ? "Finished · Read-only"
          : "Active"
        : "";
  let html =
    back(labels[area]) +
    heading(
      c.title,
      c.kind === "run"
        ? `From ${c.sourceTitle ?? "a checklist template"}`
        : c.kind === "template"
          ? "Checklist template"
          : c.kind === "task"
            ? "Personal task"
            : `${items.filter((i) => !i.completed).length} needed · ${items.filter((i) => i.completed).length} purchased`,
    ) +
    (status ? badge(status, locked) : "") +
    (c.kind === "run"
      ? `<p class="subtitle">${items.filter((i) => i.completed).length} of ${items.length} complete</p><div class="progress"><span style="width:${items.length ? (items.filter((i) => i.completed).length / items.length) * 100 : 0}%"></span></div>`
      : "") +
    (c.notes
      ? `<p class="description" style="white-space:pre-wrap">${escape(c.notes)}</p>`
      : "") +
    collectionControls(c);
  if (c.kind === "task") return html;
  if (!locked)
    html += `<div class="actions">${c.kind === "template" ? btn("Start run", "start", c.id, "primary", !items.length) : ""}${btn("Add item", "new-item", "", c.kind === "shopping" ? "primary" : "")}${btn("Add section", "new-section")}${btn("Organize", "organize")}</div>`;
  if (!items.length)
    html += empty(
      "No items yet.",
      c.kind === "template"
        ? "Add at least one item before starting a run."
        : "Add items when you are ready.",
    );
  for (const group of [...c.sections, { id: "", title: "Unsectioned" }]) {
    let groupItems = items.filter((i) => i.section === group.id);
    if (!group.id && !groupItems.length) continue;
    if (c.kind === "shopping")
      groupItems = [
        ...groupItems.filter((i) => !i.completed),
        ...groupItems.filter((i) => i.completed),
      ];
    html += `<div class="section-heading"><h2>${escape(group.title)}</h2>${group.id && !locked ? quiet("Section actions", "section-menu", group.id) : ""}</div>${groupItems.map((item) => itemRow(c, item)).join("")}`;
  }
  if (!locked && c.kind === "shopping")
    html += `<div class="actions">${btn("Mark all purchased items as needed", "reset-purchases", c.id, "", !items.some((i) => i.completed))}</div>`;
  if (!locked && c.kind === "run")
    html += `<div class="actions end">${btn("Finish run", "finish", c.id, "primary")}</div>`;
  return html;
}
function showValue(value: unknown): string {
  if (value === null) return "—";
  if (typeof value !== "object") return String(value);
  const names: Record<string, string> = {
    title: "Name",
    notes: "Notes",
    quantity: "Quantity",
    section: "Section",
    completed: "Complete",
    trashed: "In Trash",
    archived: "Archived",
    finished: "Finished",
    position: "Position",
  };
  return Object.entries(value)
    .filter(([key]) => key !== "id")
    .map(([key, entry]) => {
      const display =
        typeof entry === "boolean" ? (entry ? "Yes" : "No") : entry || "—";
      return `${names[key] ?? key}: ${display}`;
    })
    .join("\n");
}
function historyMarkup(c: Collection): string {
  const history = visible.history
    .filter((event) => event.parent === c.id)
    .reverse();
  return (
    back(c.title, "detail") +
    heading(
      `${c.title} · History`,
      "Successful changes only · Times shown in your device timezone",
    ) +
    history
      .slice(0, historyLimit)
      .map(
        (event) =>
          `<article class="event"><p class="event-meta">${escape(formatDate(event.at))} · Owner</p><h2>${escape(event.title)} · ${escape(event.action)}</h2><div class="compare"><div><div class="compare-label">Before</div><p class="event-value">${escape(showValue(event.before))}</p></div><div><div class="compare-label">After</div><p class="event-value">${escape(showValue(event.after))}</p></div></div></article>`,
      )
      .join("") +
    (history.length > historyLimit
      ? `<div class="actions">${btn("Load older changes", "older-history")}</div>`
      : "")
  );
}
function organizeMarkup(c: Collection): string {
  return (
    back(c.title, "detail") +
    heading(`Organize ${c.title}`, "Each acknowledged move is saved.") +
    [...c.sections, { id: "", title: "Unsectioned" }]
      .map((group, index) => {
        const members = activeItems(c).filter((i) => i.section === group.id);
        return `<section class="order-section"><h2>${escape(group.title)}</h2>${group.id ? `<div class="row-actions">${btn("Move section up", "section-up", group.id, "quiet", index === 0)}${btn("Move section down", "section-down", group.id, "quiet", index === c.sections.length - 1)}${quiet("Rename section", "edit-section", group.id)}${quiet("Remove section", "remove-section", group.id)}</div>` : ""}${members.map((item, itemIndex) => `<div class="order-item"><strong>${escape(item.title)}</strong>${c.kind === "shopping" ? `<p class="collection-note">${item.completed ? "Purchased" : "Needed"}</p>` : ""}<div class="row-actions">${btn("Move up", "item-up", item.id, "quiet", itemIndex === 0)}${btn("Move down", "item-down", item.id, "quiet", itemIndex === members.length - 1)}</div><label class="hint" for="move-${item.id}">Move ${escape(item.title)} to section</label><select id="move-${item.id}" data-move="${item.id}"${busy ? " disabled" : ""}>${[...c.sections, { id: "", title: "Unsectioned" }].map((s) => `<option value="${s.id}"${item.section === s.id ? " selected" : ""}>${escape(s.title)}</option>`).join("")}</select></div>`).join("")}</section>`;
      })
      .join("") +
    `<div class="actions end">${btn("Done", "detail", "", "primary")}</div>`
  );
}
function field(
  name: keyof Draft,
  label: string,
  limit: number,
  multiline = false,
): string {
  const value = editor!.draft[name];
  return `<div class="label-row"><label for="draft-${name}">${escape(label)}</label><span class="counter" id="count-${name}">${count(value)} / ${limit.toLocaleString()}</span></div>${multiline ? `<textarea` : `<input type="text"`} id="draft-${name}" name="${name}" aria-describedby="hint-${name} count-${name}" aria-invalid="${Boolean(errors[name])}"${busy || pending ? " disabled" : ""}${multiline ? `>${escape(value)}</textarea>` : ` value="${escape(value)}">`}<p id="hint-${name}" class="hint${errors[name] ? " error" : ""}">${escape(errors[name] ?? (name === "title" ? "Required" : name === "quantity" ? "Free text; no unit conversion." : "Plain text."))}</p>`;
}
function formMarkup(): string {
  const e = editor!;
  const c = visible.collections.find((c) => c.id === e.parent);
  const title =
    e.mode === "start"
      ? "Start checklist run"
      : `${e.target ? "Edit" : "New"} ${e.mode === "collection" ? singular[e.kind] : e.mode === "section" ? "section" : "item"}`;
  return (
    back(c?.title ?? labels[area]) +
    heading(title, e.mode === "start" ? `From ${c!.title}` : "") +
    `<form id="everyday-form" novalidate>${field("title", e.mode === "start" ? "Run name *" : e.kind === "task" ? "Title *" : "Name *", 200)}${e.mode === "item" && e.kind === "shopping" ? field("quantity", "Quantity (optional)", 100) : ""}${e.mode !== "section" && e.mode !== "start" ? field("notes", "Notes (optional)", 10000, true) : ""}${e.mode === "item" ? `<div class="label-row"><label for="draft-section">Section</label></div><select id="draft-section" name="section"${busy || pending ? " disabled" : ""}>${[...c!.sections, { id: "", title: "Unsectioned" }].map((s) => `<option value="${s.id}"${s.id === e.draft.section ? " selected" : ""}>${escape(s.title)}</option>`).join("")}</select>` : ""}${e.mode === "start" ? notice("A fresh copy, just for this run", "Copies the current sections, items, and notes. Every item starts unchecked. Other runs and the template stay unchanged.") : ""}<div class="actions end">${btn("Cancel", "back")}<button type="submit" class="primary"${busy || pending ? " disabled" : ""}>${busy ? "Saving…" : e.mode === "start" ? "Start run" : e.mode === "collection" ? `Save ${singular[e.kind]}` : `Save ${e.mode}`}</button></div></form>`
  );
}
function errorMarkup(): string {
  if (!errorMessage) return "";
  const saved = pending?.parent
    ? server.collections.find((c) => c.id === pending!.parent)
    : undefined;
  return `<div class="notice error" role="alert"><div><strong>${escape(errorMessage)}</strong>${editor ? "Your draft has been kept." : "The displayed state is still the last confirmed version."}${conflict && editor ? `<div class="compare"><div><div class="compare-label">Your draft</div>${escape(editor.draft.title)}<br>${escape(editor.draft.quantity || editor.draft.notes)}</div><div><div class="compare-label">Latest saved</div>${escape(editor.mode === "item" ? (saved?.items.find((i) => i.id === editor!.target)?.title ?? "Item removed") : (saved?.title ?? "Collection removed"))}<br>${escape(editor.mode === "item" ? saved?.items.find((i) => i.id === editor!.target)?.quantity || saved?.items.find((i) => i.id === editor!.target)?.notes : saved?.notes)}</div></div>` : ""}<div class="actions">${conflict ? btn("Review latest version", "review-latest") : pending ? btn("Retry save", "retry") : ""}</div></div></div>`;
}
function render(focus = false): void {
  let body: string;
  if (!signedIn) {
    body = `<section class="page">${empty(denied ? "This account doesn’t have access." : "Your everyday lists.", denied ? "Try the simulated approved owner account." : "Shopping, travel, and cooking, ready to use again.", `<button type="button" class="google" data-action="signin"><img src="${escape(googleMark)}" alt="" width="20" height="20">Continue with Google</button>`)}<p class="hint" style="text-align:center">Prototype only: sign-in is simulated. No Google request is made.${editor ? " Your unsaved draft is retained in this tab." : ""}</p></section>`;
  } else if (screen !== "normal") {
    body = `<section class="page">${heading(labels[area])}${empty(screen === "loading" ? "Opening your list…" : "Couldn’t load your list.", screen === "loading" ? "The server may take a moment to start." : "Check your connection and try again.", btn(screen === "loading" ? "Finish loading" : "Try again", "finish-loading", "", "primary"))}</section>`;
  } else {
    const c = current();
    body = `<section class="page${editor ? " narrow" : ""}">${message ? notice(message) : ""}${busy ? notice("Saving…", "Waiting for confirmation. Your last confirmed state remains visible.") : ""}${errorMarkup()}${editor ? formMarkup() : selected && c ? (detailMode === "history" ? historyMarkup(c) : detailMode === "organize" ? organizeMarkup(c) : detailMarkup(c)) : indexMarkup()}</section>${footer()}`;
  }
  app.setAttribute("aria-busy", String(busy));
  app.innerHTML = header() + body;
  document.title = `${editor ? "Edit" : (current()?.title ?? labels[area])} · local prototype`;
  inspect();
  if (errorMessage && !busy && signedIn)
    requestAnimationFrame(() =>
      app
        .querySelector<HTMLElement>(
          conflict ? '[data-action="review-latest"]' : '[data-action="retry"]',
        )
        ?.focus(),
    );
  else if (focus)
    requestAnimationFrame(() =>
      (
        app.querySelector<HTMLElement>(editor ? "input" : "#page-title") ??
        app.querySelector<HTMLElement>("button")
      )?.focus(),
    );
}

function announce(text: string): void {
  announcer.textContent = text;
}
function closeModal(): void {
  modalAction = null;
  dialog.close();
  if (modalReturn?.isConnected) modalReturn.focus();
  else app.querySelector<HTMLElement>("#page-title")?.focus();
}
function confirm(
  title: string,
  description: string,
  action: () => void,
  label = "Confirm",
  danger = false,
): void {
  modalReturn = document.activeElement as HTMLElement;
  modalAction = action;
  dialog.innerHTML = `<div class="dialog-icon${danger ? " danger" : ""}">${icon("list")}</div><h2 id="dialog-title">${escape(title)}</h2><p id="dialog-description">${escape(description)}</p><div class="actions end"><button type="button" data-dialog="cancel" autofocus>Cancel</button><button type="button" data-dialog="confirm" class="${danger ? "danger" : "primary"}">${escape(label)}</button></div>`;
  dialog.showModal();
  dialog.querySelector<HTMLElement>("[data-dialog=cancel]")?.focus();
}
function go(action: () => void): void {
  if (pending) {
    message = "Retry or review the pending save before switching views.";
    render();
    return;
  }
  const proceed = () => {
    editor = null;
    errors = {};
    message = "";
    action();
    render(true);
  };
  if (dirty())
    confirm(
      "Discard unsaved changes?",
      "Your draft has not been saved. Keep editing by choosing Cancel.",
      proceed,
      "Discard changes",
    );
  else proceed();
}
function beginEditor(
  mode: Editor["mode"],
  parent: Collection | undefined,
  target = "",
): void {
  if (pending) {
    announce("Retry or review the pending save first.");
    return;
  }
  const item =
    mode === "item" && target
      ? parent?.items.find((i) => i.id === target)
      : undefined;
  const section =
    mode === "section" && target
      ? parent?.sections.find((s) => s.id === target)
      : undefined;
  const draft = {
    title:
      mode === "start"
        ? [...`${parent!.title} — ${localDate()}`].slice(0, 200).join("")
        : (item?.title ??
          section?.title ??
          (mode === "collection" && target ? parent!.title : "")),
    notes:
      item?.notes ?? (mode === "collection" && target ? parent!.notes : ""),
    quantity: item?.quantity ?? "",
    section: item?.section ?? "",
  };
  editor = {
    mode,
    parent: parent?.id ?? "",
    target,
    kind: parent?.kind ?? (area as Kind),
    draft,
    original: JSON.stringify(draft),
    revision: parent?.revision ?? 0,
  };
  errors = {};
  errorMessage = "";
  message = "";
  render(true);
}
async function execute(op: Operation): Promise<void> {
  if (busy || !signedIn) return;
  pending = op;
  busy = true;
  errorMessage = "";
  conflict = false;
  message = "";
  const result = nextResult.value;
  nextResult.value = "success";
  render();
  await new Promise((resolve) =>
    setTimeout(resolve, Number(delaySelect.value)),
  );
  if (result === "expired") {
    signedIn = false;
    busy = false;
    errorMessage = "Your session expired before this save.";
    render(true);
    return;
  }
  if (result === "failure") {
    busy = false;
    errorMessage = "Couldn’t save this change. Retry to confirm it.";
    render();
    announce(errorMessage);
    return;
  }
  if (!applied.has(op.id)) {
    if (result === "conflict" && op.parent) {
      const other = server.collections.find((c) => c.id === op.parent);
      if (other) {
        const before = collectionValues(other);
        other.notes = `${other.notes}${other.notes ? "\n" : ""}Changed in another tab.`;
        if (editor?.mode === "item" && editor.target) {
          const i = other.items.find((i) => i.id === editor!.target);
          if (i) {
            const previous = copy(i);
            i.quantity = "Changed in another tab";
            i.notes = "Another tab saved this item.";
            change(
              server,
              other,
              i.id,
              i.title,
              "Edited in another tab",
              previous,
              i,
            );
          }
        }
        change(
          server,
          other,
          other.id,
          other.title,
          "Edited in another tab",
          before,
          collectionValues(other),
        );
        other.revision++;
      }
    }
    const savedParent = op.parent
      ? server.collections.find((c) => c.id === op.parent)
      : undefined;
    if (op.parent && (!savedParent || savedParent.revision !== op.revision)) {
      busy = false;
      conflict = true;
      errorMessage = "This collection changed. Your action has not been saved.";
      render();
      announce(errorMessage);
      return;
    }
    try {
      const next = copy(server);
      op.apply(next);
      const changedParent = next.collections.find((c) => c.id === op.parent);
      if (changedParent && !op.readOnlyParent) changedParent.revision++;
      server = next;
      applied.add(op.id);
    } catch (error) {
      busy = false;
      errorMessage =
        error instanceof Error
          ? error.message
          : "This action could not be completed.";
      conflict = true;
      render();
      return;
    }
  }
  busy = false;
  if (result === "lost") {
    errorMessage = "The save response was lost. Retry to confirm the result.";
    render();
    announce(errorMessage);
    return;
  }
  visible = copy(server);
  pending = null;
  message = `${op.label} saved.`;
  op.done?.();
  render(true);
  announce(message);
}
function mutate(
  c: Collection,
  label: string,
  apply: Operation["apply"],
  done?: () => void,
): void {
  if (pending) {
    announce("Retry or review the pending save before another change.");
    return;
  }
  void execute({
    id: uid(),
    label,
    parent: c.id,
    revision: c.revision,
    apply,
    done,
  });
}
function editParent(
  s: DemoState,
  c: Collection,
  action: string,
  apply: (saved: Collection) => void,
): void {
  const saved = serverCollection(s, c.id);
  const before = collectionValues(saved);
  apply(saved);
  change(
    s,
    saved,
    saved.id,
    saved.title,
    action,
    before,
    collectionValues(saved),
  );
}
function editItem(
  s: DemoState,
  parent: string,
  id: string,
  action: string,
  apply: (saved: DemoItem, c: Collection) => void,
): void {
  const c = serverCollection(s, parent);
  const item = itemById(c, id);
  if (!item)
    throw new Error("This item no longer exists. Review the latest version.");
  const before = copy(item);
  apply(item, c);
  change(s, c, item.id, item.title, action, before, item);
}
function saveForm(): void {
  if (!editor || busy) return;
  if (pending) {
    void execute(pending);
    return;
  }
  const e = copy(editor);
  const d = e.draft;
  errors = {};
  if (!d.title.trim())
    errors.title = "Enter a name. Whitespace alone is not valid.";
  else if (count(d.title) > 200)
    errors.title = "Use no more than 200 characters.";
  if (count(d.notes) > 10000)
    errors.notes = "Use no more than 10,000 characters.";
  if (count(d.quantity) > 100)
    errors.quantity = "Use no more than 100 characters.";
  if (Object.keys(errors).length) {
    render();
    requestAnimationFrame(() =>
      app.querySelector<HTMLElement>("[aria-invalid=true]")?.focus(),
    );
    return;
  }
  const newId = uid();
  const apply = (s: DemoState) => {
    if (e.mode === "collection" && !e.target) {
      const c = baseCollection(e.kind, d.title.trim());
      c.id = newId;
      c.notes = d.notes;
      s.collections.push(c);
      change(s, c, c.id, c.title, "Created", null, collectionValues(c));
      return;
    }
    const c = serverCollection(s, e.parent);
    if (!c || readonly(c))
      throw new Error(
        "This collection is read-only or no longer available. Review the latest version.",
      );
    if (e.mode === "collection")
      editParent(s, c, "Details edited", (saved) => {
        saved.title = d.title.trim();
        saved.notes = d.notes;
      });
    if (e.mode === "section") {
      if (e.target) {
        const section = c.sections.find((section) => section.id === e.target)!;
        if (!section) throw new Error("This section no longer exists.");
        const before = copy(section);
        section.title = d.title.trim();
        change(
          s,
          c,
          section.id,
          section.title,
          "Section renamed",
          before,
          section,
        );
      } else {
        const section = { id: newId, title: d.title.trim() };
        c.sections.push(section);
        change(
          s,
          c,
          section.id,
          section.title,
          "Section created",
          null,
          section,
        );
      }
    }
    if (e.mode === "item") {
      if (d.section && !c.sections.some((section) => section.id === d.section))
        throw new Error(
          "This section no longer exists. Review the latest version.",
        );
      if (e.target)
        editItem(s, c.id, e.target, "Item edited", (item, parent) => {
          const moved = item.section !== d.section;
          Object.assign(item, {
            title: d.title.trim(),
            notes: d.notes,
            quantity: d.quantity,
            section: d.section,
          });
          if (moved)
            parent.items = [
              ...parent.items.filter((i) => i.id !== item.id),
              item,
            ];
        });
      else {
        const item = baseItem(d.title.trim(), d.section, d.notes, d.quantity);
        item.id = newId;
        c.items.push(item);
        change(s, c, item.id, item.title, "Item added", null, item);
      }
    }
    if (e.mode === "start") {
      if (c.kind !== "template" || !activeItems(c).length)
        throw new Error("Add at least one item to an active template first.");
      const run = baseCollection("run", d.title.trim());
      run.id = newId;
      run.notes = c.notes;
      run.sourceId = c.id;
      run.sourceTitle = c.title;
      const sectionIds = new Map(
        c.sections.map((section) => [section.id, uid()]),
      );
      run.sections = c.sections.map((section) => ({
        ...section,
        id: sectionIds.get(section.id)!,
      }));
      run.items = activeItems(c).map((item) => ({
        ...copy(item),
        id: uid(),
        section: sectionIds.get(item.section) ?? "",
        completed: false,
        trashed: false,
      }));
      s.collections.push(run);
      change(
        s,
        run,
        run.id,
        run.title,
        "Run started",
        null,
        collectionValues(run),
      );
      for (const section of run.sections)
        change(
          s,
          run,
          section.id,
          section.title,
          "Section copied",
          null,
          section,
        );
      for (const item of run.items)
        change(s, run, item.id, item.title, "Item copied", null, item);
    }
  };
  void execute({
    id: uid(),
    label:
      e.mode === "start"
        ? "Checklist run"
        : e.mode === "collection"
          ? labels[e.kind]
          : e.mode,
    parent: e.parent,
    revision: e.revision,
    readOnlyParent: e.mode === "start",
    apply,
    done: () => {
      editor = null;
      errors = {};
      if (e.mode === "start") {
        area = "run";
        selected = newId;
        runFilter = "active";
        detailMode = "detail";
      } else if (e.mode === "collection" && !e.target) {
        selected = e.kind === "task" ? "" : newId;
        detailMode = "detail";
      } else if (e.kind === "task") selected = "";
      else selected = e.parent;
    },
  });
}
function restoreItem(parent: Collection, id: string): void {
  let destination = "";
  mutate(
    parent,
    "Item restoration",
    (s) =>
      editItem(s, parent.id, id, "Restored", (item, c) => {
        if (readonly(c))
          throw new Error(
            "Restore, unarchive, or reopen the parent before restoring this item.",
          );
        item.trashed = false;
        if (
          item.section &&
          !c.sections.some((section) => section.id === item.section)
        ) {
          item.section = "";
          c.items = [...c.items.filter((i) => i.id !== id), item];
          destination =
            "Restored to Unsectioned because its former section no longer exists.";
        }
      }),
    () => {
      if (destination) message = destination;
    },
  );
}
function erase(c: Collection, item?: DemoItem): void {
  const title = item?.title ?? c.title;
  confirm(
    `Erase ${title} permanently?`,
    item
      ? "This cannot be undone through Trash. Erases this item's content and its entries in the parent history. Independent checklist copies remain. Encrypted backups expire under the seven-day retention policy."
      : "This cannot be undone through Trash. Erases this collection, all sections and items (including individually trashed items), and associated content history. Independent runs keep their copies. Encrypted backups expire under the seven-day retention policy.",
    () => {
      mutate(
        c,
        "Permanent erasure",
        (s) => {
          const saved = serverCollection(s, c.id);
          if (item) {
            const existing = itemById(saved, item.id);
            if (!existing?.trashed)
              throw new Error("Move this item to Trash before erasing it.");
            saved.items = saved.items.filter((i) => i.id !== item.id);
            s.history = s.history.filter((event) => event.target !== item.id);
            s.erasedIds.push(item.id);
          } else {
            if (!saved.trashed)
              throw new Error(
                "Move this collection to Trash before erasing it.",
              );
            s.erasedIds.push(
              saved.id,
              ...saved.items.map((i) => i.id),
              ...saved.sections.map((section) => section.id),
            );
            s.history = s.history.filter((event) => event.parent !== c.id);
            s.collections = s.collections.filter(
              (collection) => collection.id !== c.id,
            );
          }
        },
        () => {
          if (!item) selected = "";
        },
      );
    },
    "Erase permanently",
    true,
  );
}
function moveItem(c: Collection, id: string, direction: number): void {
  const item = itemById(c, id);
  const members = activeItems(c).filter((i) => i.section === item.section);
  const position = members.findIndex((i) => i.id === id);
  const neighbor = members[position + direction];
  if (!neighbor) return;
  mutate(c, "Item order", (s) => {
    const saved = serverCollection(s, c.id);
    if (readonly(saved)) throw new Error("This collection is read-only.");
    const a = saved.items.findIndex((i) => i.id === id),
      b = saved.items.findIndex((i) => i.id === neighbor.id);
    [saved.items[a], saved.items[b]] = [saved.items[b]!, saved.items[a]!];
    change(
      s,
      saved,
      id,
      item.title,
      "Order changed",
      { position: position + 1 },
      { position: position + direction + 1 },
    );
  });
}
function moveSection(c: Collection, id: string, direction: number): void {
  const index = c.sections.findIndex((section) => section.id === id);
  if (!c.sections[index + direction]) return;
  mutate(c, "Section order", (s) => {
    const saved = serverCollection(s, c.id);
    if (readonly(saved)) throw new Error("This collection is read-only.");
    [saved.sections[index], saved.sections[index + direction]] = [
      saved.sections[index + direction]!,
      saved.sections[index]!,
    ];
    change(
      s,
      saved,
      id,
      saved.sections[index + direction]!.title,
      "Section order changed",
      { position: index + 1 },
      { position: index + direction + 1 },
    );
  });
}
function removeSection(c: Collection, id: string): void {
  const section = c.sections.find((section) => section.id === id)!;
  confirm(
    `Remove ${section.title}?`,
    "Move its items to Unsectioned, preserving their relative order. No items will be removed.",
    () => {
      mutate(c, "Section removal", (s) => {
        const saved = serverCollection(s, c.id);
        if (readonly(saved)) throw new Error("This collection is read-only.");
        const members = saved.items.filter(
          (item) => item.section === id && !item.trashed,
        );
        for (const item of members)
          editItem(s, saved.id, item.id, "Moved to Unsectioned", (i) => {
            i.section = "";
          });
        saved.items = [
          ...saved.items.filter(
            (item) => !members.some((i) => i.id === item.id),
          ),
          ...members,
        ];
        saved.sections = saved.sections.filter((section) => section.id !== id);
        change(s, saved, id, section.title, "Section removed", section, null);
      });
    },
    "Remove section",
  );
}

function handle(action: string, id: string, parentId = ""): void {
  if (busy) return;
  const c =
    visible.collections.find((c) => c.id === (parentId || id)) ?? current();
  if (action === "signin") {
    signedIn = true;
    denied = false;
    visible = copy(server);
    render(true);
    return;
  }
  if (!signedIn) return;
  if (action === "retry" && pending) {
    void execute(pending);
    return;
  }
  if (action === "review-latest") {
    visible = copy(server);
    if (editor)
      editor.revision =
        visible.collections.find((c) => c.id === editor!.parent)?.revision ?? 0;
    pending = null;
    conflict = false;
    errorMessage = "";
    message = editor
      ? "Latest version loaded. Your draft is retained. Compare it, edit if needed, then explicitly save again."
      : "Latest version loaded. Review before trying the action again.";
    render(true);
    return;
  }
  if (pending) {
    message =
      "Retry or review the pending save before leaving or making another change.";
    render();
    return;
  }
  if (action === "area") {
    go(() => {
      area = id as Area;
      selected = "";
      detailMode = "detail";
      screen = "normal";
    });
    return;
  }
  if (action === "filter") {
    go(() => {
      runFilter = id;
      selected = "";
    });
    return;
  }
  if (action === "open") {
    go(() => {
      selected = id;
      detailMode = "detail";
    });
    return;
  }
  if (action === "task-history") {
    go(() => {
      selected = id;
      detailMode = "history";
      historyLimit = 12;
    });
    return;
  }
  if (action === "back") {
    const wasEditing = Boolean(editor);
    go(() => {
      if (!wasEditing) selected = "";
      detailMode = "detail";
    });
    return;
  }
  if (action === "detail") {
    detailMode = "detail";
    render(true);
    return;
  }
  if (action === "history") {
    detailMode = "history";
    historyLimit = 12;
    render(true);
    return;
  }
  if (action === "older-history") {
    historyLimit += 12;
    render();
    return;
  }
  if (action === "organize" && c && !readonly(c)) {
    detailMode = "organize";
    render(true);
    return;
  }
  if (action === "new-parent") {
    beginEditor("collection", undefined);
    return;
  }
  if (action === "edit-parent" && c && !readonly(c)) {
    beginEditor("collection", c, c.id);
    return;
  }
  if (action === "new-item" && c && !readonly(c)) {
    beginEditor("item", c);
    return;
  }
  if (action === "edit-item" && c && !readonly(c)) {
    beginEditor("item", c, id);
    return;
  }
  if (action === "new-section" && c && !readonly(c)) {
    beginEditor("section", c);
    return;
  }
  if (action === "edit-section" && c && !readonly(c)) {
    beginEditor("section", c, id);
    return;
  }
  if (action === "start" && c && !readonly(c) && activeItems(c).length) {
    beginEditor("start", c);
    return;
  }
  if (action === "signout") {
    go(() => {
      signedIn = false;
      denied = false;
      selected = "";
    });
    return;
  }
  if (action === "finish-loading") {
    screen = "normal";
    render(true);
    return;
  }
  if (!c) return;
  if (action === "section-menu" && !readonly(c)) {
    const section = c.sections.find((section) => section.id === id)!;
    modalReturn = document.activeElement as HTMLElement;
    dialog.innerHTML = `<h2 id="dialog-title">${escape(section.title)}</h2><p id="dialog-description">Rename, reorder, or remove this section. Removing preserves its items.</p><div class="actions">${btn("Rename section", "edit-section", id)}${btn("Organize sections", "organize")}${btn("Remove section", "remove-section", id)}</div><div class="actions end"><button type="button" data-dialog="cancel" autofocus>Close</button></div>`;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("button")?.focus();
    return;
  }
  if (action === "toggle-task") {
    const desired = !c.completed;
    mutate(c, "Task progress", (s) =>
      editParent(s, c, desired ? "Completed" : "Reopened", (saved) => {
        if (readonly(saved)) throw new Error("This task is read-only.");
        saved.completed = desired;
      }),
    );
    return;
  }
  if (action === "toggle-item" && !readonly(c)) {
    const desired = !itemById(c, id).completed;
    mutate(c, "Item progress", (s) =>
      editItem(
        s,
        c.id,
        id,
        desired ? "Checked" : "Unchecked",
        (item, parent) => {
          if (readonly(parent) || item.trashed)
            throw new Error("This item is read-only.");
          item.completed = desired;
        },
      ),
    );
    return;
  }
  if (action === "trash-parent") {
    confirm(
      `Move ${c.title} to Trash?`,
      "Its contents will be hidden together. You can restore it later. Existing independent checklist runs stay available.",
      () =>
        mutate(
          c,
          "Move to Trash",
          (s) =>
            editParent(s, c, "Moved to Trash", (saved) => {
              saved.trashed = true;
            }),
          () => {
            selected = "";
          },
        ),
      "Move to Trash",
    );
    return;
  }
  if (action === "restore-parent") {
    mutate(c, "Restoration", (s) =>
      editParent(s, c, "Restored", (saved) => {
        saved.trashed = false;
      }),
    );
    return;
  }
  if (action === "archive") {
    confirm(
      `Archive ${c.title}?`,
      "Keep this collection read-only outside active views. Existing runs stay available.",
      () =>
        mutate(c, "Archive", (s) =>
          editParent(s, c, "Archived", (saved) => {
            saved.archived = true;
          }),
        ),
      "Archive",
    );
    return;
  }
  if (action === "unarchive") {
    mutate(c, "Unarchive", (s) =>
      editParent(s, c, "Unarchived", (saved) => {
        saved.archived = false;
      }),
    );
    return;
  }
  if (action === "trash-item" && !readonly(c)) {
    mutate(c, "Move item to Trash", (s) =>
      editItem(s, c.id, id, "Moved to Trash", (item, parent) => {
        if (readonly(parent)) throw new Error("This collection is read-only.");
        item.trashed = true;
      }),
    );
    return;
  }
  if (action === "restore-item") {
    restoreItem(c, id);
    return;
  }
  if (action === "erase-parent") {
    erase(c);
    return;
  }
  if (action === "erase-item") {
    erase(c, itemById(c, id));
    return;
  }
  if (action === "finish" && !readonly(c)) {
    const unchecked = activeItems(c).filter((item) => !item.completed).length;
    const finish = () =>
      mutate(c, "Run completion", (s) =>
        editParent(s, c, "Run finished", (saved) => {
          if (readonly(saved)) throw new Error("This run is read-only.");
          saved.finished = true;
        }),
      );
    if (unchecked)
      confirm(
        "Finish this run?",
        `${unchecked} of ${activeItems(c).length} items are still unchecked. Finish anyway? You can reopen it later.`,
        finish,
        "Finish run",
      );
    else finish();
    return;
  }
  if (action === "reopen" && !c.archived && !c.trashed) {
    mutate(c, "Run reopening", (s) =>
      editParent(s, c, "Run reopened", (saved) => {
        saved.finished = false;
      }),
    );
    return;
  }
  if (action === "reset-purchases" && !readonly(c)) {
    const n = activeItems(c).filter((item) => item.completed).length;
    confirm(
      "Ready for another trip?",
      `Mark ${n} purchased items as needed again? They return to their saved manual positions. Nothing is removed.`,
      () =>
        mutate(c, "Shopping reset", (s) => {
          const saved = serverCollection(s, c.id);
          if (readonly(saved)) throw new Error("This list is read-only.");
          for (const item of activeItems(saved).filter((i) => i.completed))
            editItem(s, saved.id, item.id, "Marked needed", (i) => {
              i.completed = false;
            });
        }),
      "Mark as needed",
    );
    return;
  }
  if (readonly(c)) return;
  if (action === "item-up" || action === "item-down") {
    moveItem(c, id, action === "item-up" ? -1 : 1);
    return;
  }
  if (action === "section-up" || action === "section-down") {
    moveSection(c, id, action === "section-up" ? -1 : 1);
    return;
  }
  if (action === "remove-section") removeSection(c, id);
}

app.addEventListener("click", (event) => {
  const control = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-action]",
  );
  if (control && !control.disabled)
    handle(
      control.dataset.action!,
      control.dataset.id ?? "",
      control.dataset.parent ?? "",
    );
});
app.addEventListener("submit", (event) => {
  if ((event.target as HTMLElement).id === "everyday-form") {
    event.preventDefault();
    saveForm();
  }
});
app.addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (!editor || !(input.name in editor.draft)) return;
  editor.draft[input.name as keyof Draft] = input.value;
  const counter = document.querySelector<HTMLElement>(`#count-${input.name}`);
  const limit =
    input.name === "notes" ? 10000 : input.name === "quantity" ? 100 : 200;
  if (counter)
    counter.textContent = `${count(input.value)} / ${limit.toLocaleString()}`;
  inspect();
});
app.addEventListener("change", (event) => {
  const control = event.target as HTMLSelectElement;
  if (control.name === "section" && editor) {
    editor.draft.section = control.value;
    inspect();
    return;
  }
  const c = current();
  if (control.dataset.move && c && !readonly(c)) {
    const id = control.dataset.move,
      section = control.value;
    mutate(c, "Item section", (s) =>
      editItem(s, c.id, id, "Section changed", (item, parent) => {
        if (readonly(parent)) throw new Error("This collection is read-only.");
        item.section = section;
        parent.items = [...parent.items.filter((i) => i.id !== id), item];
      }),
    );
  }
});
dialog.addEventListener("click", (event) => {
  const control = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button",
  );
  if (!control) return;
  if (control.dataset.dialog === "cancel") {
    closeModal();
    return;
  }
  if (control.dataset.dialog === "confirm") {
    const action = modalAction;
    closeModal();
    action?.();
    return;
  }
  if (control.dataset.action) {
    closeModal();
    handle(control.dataset.action, control.dataset.id ?? "");
  }
});
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeModal();
});
window.addEventListener("beforeunload", (event) => {
  if (dirty()) {
    event.preventDefault();
  }
});
document.querySelector("#reset-demo")!.addEventListener("click", () => {
  confirm(
    "Reset the prototype?",
    "All synthetic changes, history, drafts, and erasures will reset. This does not touch production data.",
    () => {
      server = initialState();
      visible = copy(server);
      applied.clear();
      pending = null;
      editor = null;
      errors = {};
      errorMessage = "";
      conflict = false;
      message = "Demo reset.";
      selected = "";
      area = "shopping";
      screen = "normal";
      signedIn = false;
      denied = false;
      nextResult.value = "success";
      render(true);
    },
    "Reset demo",
  );
});
document.querySelector("#show-scenario")!.addEventListener("click", () => {
  const value = scenario.value;
  if (value === "expired") {
    signedIn = false;
    denied = false;
    message = "";
    render(true);
    return;
  }
  go(() => {
    signedIn = true;
    denied = false;
    screen = "normal";
    selected = "";
    detailMode = "detail";
    if (value === "empty") {
      server = initialState(true);
      visible = copy(server);
      applied.clear();
      pending = null;
      area = "shopping";
    }
    if (value === "shopping") {
      area = "shopping";
      selected =
        visible.collections.find(
          (c) => c.kind === "shopping" && !c.archived && !c.trashed,
        )?.id ?? "";
    }
    if (value === "travel") {
      area = "template";
      selected =
        visible.collections.find(
          (c) =>
            c.kind === "template" && c.title.includes("Camping") && !c.trashed,
        )?.id ?? "";
    }
    if (value === "cooking") {
      area = "run";
      runFilter = "active";
      selected =
        visible.collections.find(
          (c) => c.kind === "run" && !c.finished && !c.archived && !c.trashed,
        )?.id ?? "";
    }
    if (value === "recovery") area = "trash";
    if (value === "loading") screen = "loading";
    if (value === "unavailable") screen = "unavailable";
    if (value === "denied") {
      signedIn = false;
      denied = true;
    }
  });
});
render();
