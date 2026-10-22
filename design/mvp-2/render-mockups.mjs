import { readFileSync, writeFileSync } from "node:fs";

const directory = new URL("./", import.meta.url);
const css = readFileSync(new URL("mockups.css", directory), "utf8");
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
const shapes = {
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  shopping: '<path d="m3 5 2 1 2 12h12l2-9H6M9 21h.01M18 21h.01"/>',
  archive: '<path d="M4 7h16v14H4zM3 3h18v4H3zM9 11h6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7M12 7v5l3 2"/>',
  back: '<path d="m12 5-7 7 7 7M5 12h15"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v.1"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name]}</svg>`;
const button = (label, style = "", symbol = "", disabled = false) =>
  `<button type="button" class="button ${style}"${disabled ? " disabled" : ""}>${symbol ? icon(symbol) : ""}${escape(label)}</button>`;
const textButton = (label, danger = false) =>
  `<button type="button" class="text-button${danger ? " danger-text" : ""}">${escape(label)}</button>`;
const actions = (...labels) =>
  `<div class="actions">${labels.map((label) => button(label)).join("")}</div>`;
const rowActions = (...labels) =>
  `<div class="row-actions">${labels.map((label) => textButton(label, label.includes("Trash") || label.includes("Erase"))).join("")}</div>`;
const badge = (label, neutral = false) =>
  `<span class="badge${neutral ? " neutral" : ""}">${escape(label)}</span>`;
const heading = (title, subtitle = "", action = "") =>
  `<div class="heading"><div><h1>${escape(title)}</h1>${subtitle ? `<p class="subline">${escape(subtitle)}</p>` : ""}</div>${action}</div>`;
const back = (label) =>
  `<div class="back">${icon("back")}${escape(label)}</div>`;
const notice = (title, detail = "", style = "") =>
  `<div class="notice ${style}">${icon(style === "error" ? "alert" : "list")}<div><strong>${escape(title)}</strong>${escape(detail)}</div></div>`;
const toolbar = (...labels) =>
  `<div class="toolbar">${labels.map((label) => button(label, "", label === "History" ? "history" : "")).join("")}</div>`;
const section = (title, editable = true) =>
  `<div class="section-title"><h2>${escape(title)}</h2>${editable ? textButton("Section actions") : ""}</div>`;
const tabs = (labels, selected, secondary = false) =>
  `<div class="tabs${secondary ? " secondary" : ""}">${labels.map((label) => `<button type="button" class="nav-button${label === selected ? " selected" : ""}">${escape(label)}</button>`).join("")}</div>`;
function app(content, area = "Shopping", mobile = false, narrow = false) {
  const nav = ["Tasks", "Shopping", "Checklists"]
    .map(
      (name) =>
        `<button type="button" class="nav-button${name === area ? " selected" : ""}"${name === area ? ' aria-current="page"' : ""}>${icon(name === "Shopping" ? "shopping" : "list")}${name}</button>`,
    )
    .join("");
  return `${mobile ? '<div class="mobile-frame">' : ""}<div class="app"><div class="app-top"><div class="brand"><span class="brand-mark">${icon("check")}</span>intrepion</div><span class="personal">Everyday lists</span></div><div class="primary-nav">${nav}</div><div class="content${narrow ? " narrow" : ""}">${content}</div><div class="app-footer"><div class="footer-links">${textButton("Archive")}${textButton("Trash")}</div><div class="account"><span class="avatar">O</span><span>Owner</span>${textButton("Sign out")}</div></div></div>${mobile ? "</div>" : ""}`;
}
function item(
  title,
  notes = "",
  checked = false,
  { template = false, readonly = false, purchased = false } = {},
) {
  return `<div class="item${template ? " no-check" : ""}${purchased && checked ? " done" : ""}">${template ? "" : `<button type="button" class="check-control" aria-label="${escape(`${checked ? "Checked" : "Unchecked"}: ${title}`)}"${readonly ? " disabled" : ""}><span class="check-box${checked ? " checked" : ""}">${checked ? icon("check") : ""}</span></button>`}<div class="item-text"><div class="item-title">${escape(title)}</div>${notes ? `<p class="item-notes">${escape(notes)}</p>` : ""}</div>${readonly ? "" : `<div class="item-tools">${textButton("Edit")}${textButton("Move to Trash", true)}</div>`}</div>`;
}
function collection(
  title,
  detail,
  status = "",
  labels = ["Open", "Edit details", "Archive", "Move to Trash"],
) {
  return `<div class="collection-row"><div class="collection-line"><div><div class="collection-name">${escape(title)}</div><p class="collection-note">${escape(detail)}</p></div>${status ? badge(status, status !== "Active") : ""}</div>${rowActions(...labels)}</div>`;
}
let fieldIndex = 0;
function field(
  label,
  value = "",
  hint = "",
  { multiline = false, invalid = false, counter = "" } = {},
) {
  const id = `field-${++fieldIndex}`;
  const hintId = `${id}-hint`;
  const attrs = `id="${id}" readonly aria-describedby="${hintId}"${invalid ? ' aria-invalid="true" class="invalid"' : ""}`;
  return `<div class="label-row"><label for="${id}">${escape(label)}</label>${counter ? `<span class="counter">${escape(counter)}</span>` : ""}</div>${multiline ? `<textarea ${attrs}>${escape(value)}</textarea>` : `<input ${attrs} value="${escape(value)}">`}<p id="${hintId}" class="hint${invalid ? " error-text" : ""}">${escape(hint)}</p>`;
}
const selectDisplay = (label, value) =>
  `<div class="label-row"><span>${escape(label)}</span></div><div class="select-display">${escape(value)} ${icon("down")}</div>`;
const formActions = (save) =>
  `<div class="actions end">${button("Cancel")}${button(save, "primary")}</div>`;
function dialog(
  title,
  content,
  confirm,
  { danger = false, symbol = "list" } = {},
) {
  return `<div class="overlay"><div class="dialog"><div class="dialog-icon${danger ? " danger" : ""}">${icon(symbol)}</div><h1>${escape(title)}</h1>${content}<div class="actions end">${button("Cancel", "focus-preview")}${button(confirm, danger ? "danger" : "primary")}</div></div></div>`;
}
function shopping(mobile = false) {
  return app(
    back("Shopping") +
      heading("Groceries", "3 needed · 2 purchased") +
      '<p class="description">For the weekend. Oat milk for breakfast.</p>' +
      toolbar("Edit details", "History", "Archive", "Move to Trash") +
      `<div class="actions">${button("Add item", "primary", "plus")}${button("Add section")}${button("Organize")}</div>` +
      section("Produce") +
      item("Apples", "6 · For lunchboxes", false, { purchased: true }) +
      item("Carrots", "1 bag · Purchased", true, { purchased: true }) +
      section("Dairy") +
      item("Milk", "2 cartons · Oat milk", false, { purchased: true }) +
      item("Yogurt", "1 tub · Purchased", true, { purchased: true }) +
      section("Unsectioned", false) +
      item("Batteries", "AA · 1 pack", false, { purchased: true }) +
      actions("Mark all purchased items as needed"),
    "Shopping",
    mobile,
  );
}
function template() {
  return app(
    back("Templates") +
      heading("Pasta dinner", "Checklist template · 4 items") +
      '<p class="description">Our usual dinner for four. Keep the pasta water for the sauce.</p>' +
      toolbar("Edit details", "History", "Archive", "Move to Trash") +
      `<div class="actions">${button("Start run", "primary")}${button("Add item", "", "plus")}${button("Add section")}${button("Organize")}</div>` +
      section("Ingredients") +
      item("Pasta — 400 g", "Use the large pot.", false, { template: true }) +
      item("Tomatoes — 1 tin", "", false, { template: true }) +
      section("Preparation") +
      item("Boil the water", "Salt before adding pasta.", false, {
        template: true,
      }) +
      item("Simmer the sauce", "Stir occasionally.", false, { template: true }),
    "Checklists",
  );
}
function run(mobile = false, finished = false) {
  const controls = finished
    ? toolbar("History", "Reopen run", "Archive", "Move to Trash")
    : toolbar("Edit details", "History", "Archive", "Move to Trash");
  return app(
    back(finished ? "Finished runs" : "Active runs") +
      heading("Pasta dinner — 24 Oct", "From Pasta dinner") +
      badge(finished ? "Finished · Read-only" : "Active", finished) +
      '<p class="subline">2 of 4 complete</p><div class="progress-track"><div class="progress-fill"></div></div>' +
      controls +
      (finished
        ? notice(
            "Finished with 2 items unchecked",
            "Reopen this run to edit items or change progress.",
            "neutral",
          )
        : actions("Add item", "Add section", "Organize")) +
      section("Ingredients", !finished) +
      item("Pasta — 400 g", "Use the large pot.", true, {
        readonly: finished,
      }) +
      item("Tomatoes — 1 tin", "", true, { readonly: finished }) +
      section("Preparation", !finished) +
      item("Boil the water", "Salt before adding pasta.", false, {
        readonly: finished,
      }) +
      item("Simmer the sauce", "Stir occasionally.", false, {
        readonly: finished,
      }) +
      (finished
        ? ""
        : `<div class="actions end">${button("Finish run", "primary")}</div>`),
    "Checklists",
    mobile,
  );
}
function itemForm(mobile = false) {
  return app(
    back("Groceries") +
      heading("Edit shopping item") +
      field("Name *", "Milk", "Required · up to 200 characters", {
        counter: "4 / 200",
      }) +
      field(
        "Quantity (optional)",
        "2 cartons",
        "Free text · up to 100 characters",
      ) +
      field(
        "Notes (optional)",
        "Oat milk",
        "Plain text · up to 10,000 characters",
        { multiline: true },
      ) +
      selectDisplay("Section", "Dairy") +
      formActions("Save item"),
    "Shopping",
    mobile,
    true,
  );
}
const boards = [];
function board(
  id,
  title,
  content,
  note,
  { wide = false, context = "Desktop" } = {},
) {
  boards.push({ id, title, content, note, wide, context });
}
board(
  "shopping-index",
  "Your shopping lists",
  app(
    heading(
      "Shopping",
      "Lists to use again and again.",
      button("New shopping list", "primary", "plus"),
    ) +
      collection("Groceries", "3 needed · 2 purchased") +
      collection("Hardware", "2 needed"),
  ),
  "Named lists sort alphabetically. Open a list to work with items; Archive and Trash stay available in the footer.",
);
board(
  "shopping",
  "A shopping list, ready to reuse",
  shopping(),
  "Needed items appear before purchased items within each section. Check/uncheck preserves underlying manual order. Saved changes appear only after server acknowledgement.",
  { wide: true },
);
board(
  "shopping-phone",
  "Shopping on a phone",
  shopping(true),
  "The same actions wrap into full-height touch controls. Purchased items remain visible within their section; Edit and Move to Trash stay explicit.",
  { context: "Phone · 390 px" },
);
board(
  "item-form",
  "A focused item form",
  itemForm(),
  "Shopping adds optional free-text quantity. Checklist items use title, notes, and section; existing tasks keep title and notes. Dedicated forms share this visual treatment.",
);
board(
  "templates",
  "Reusable checklist templates",
  app(
    heading("Checklists", "Keep a routine. Start fresh each time.") +
      tabs(["Templates", "Runs"], "Templates") +
      button("New template", "primary", "plus") +
      collection("Camping packing", "12 items · 3 sections", "Template", [
        "Open",
        "Start run",
        "Archive",
        "Move to Trash",
      ]) +
      collection("Pasta dinner", "4 items · 2 sections", "Template", [
        "Open",
        "Start run",
        "Archive",
        "Move to Trash",
      ]),
    "Checklists",
  ),
  "Travel and cooking use the same template structure. Template items have no checkmarks; progress belongs to a run.",
);
board(
  "template",
  "Ingredients and preparation",
  template(),
  "Names, collection notes, section actions, item editing, and organizing are explicit. Editing a template changes future runs only.",
  { wide: true },
);
board(
  "start-run",
  "Start a fresh run",
  app(
    back("Camping packing") +
      heading("Start checklist run", "From Camping packing") +
      field(
        "Run name *",
        "Camping packing — 2026-10-24",
        "Suggested name and today's date · editable",
        { counter: "28 / 200" },
      ) +
      notice(
        "A fresh copy, just for this run",
        "Copies current sections, items, and notes. Every item starts unchecked; existing runs and the template stay unchanged.",
      ) +
      formActions("Start run"),
    "Checklists",
    false,
    true,
  ),
  "Starting a run requires at least one non-trashed item and an active template. An uncertain response retains this name for a duplicate-safe retry.",
);
board(
  "runs",
  "Active and finished runs",
  app(
    heading("Checklists", "Pick up where you left off.") +
      tabs(["Templates", "Runs"], "Runs") +
      tabs(["Active", "Finished"], "Active", true) +
      collection(
        "November camping trip",
        "4 of 12 complete · From Camping packing",
        "Active",
        ["Open", "Archive", "Move to Trash"],
      ) +
      collection(
        "Pasta dinner — 24 Oct",
        "2 of 4 complete · From Pasta dinner",
        "Active",
        ["Open", "Archive", "Move to Trash"],
      ),
    "Checklists",
  ),
  "Newest-created runs appear first. Finished is a separate view; it does not mean archived. Create a new run from its template.",
);
board(
  "run",
  "Follow the steps in place",
  run(),
  "Each non-trashed item counts equally. Checks stay in their original positions. Editing this run leaves the source template and other runs unchanged.",
  { wide: true },
);
board(
  "run-phone",
  "Cooking on a phone",
  run(true),
  "Ingredient and preparation order stays stable during use. There are no timers, skipped states, step dependencies, or serving calculations.",
  { context: "Phone · 390 px" },
);
board(
  "finished",
  "A finished run",
  run(false, true),
  "The content is read-only. Reopen explicitly to resume editing. History, Archive, and Move to Trash remain available; unarchiving does not reopen it.",
);
board(
  "organize",
  "Organize without dragging",
  app(
    back("Groceries") +
      heading("Organize Groceries", "Each acknowledged move is saved.") +
      section("Produce", false) +
      rowActions(
        "Move section up",
        "Move section down",
        "Rename section",
        "Remove section",
      ) +
      '<div class="order-row"><strong>Apples</strong><p class="collection-note">Needed · 6</p>' +
      rowActions("Move up", "Move down", "Move to section…") +
      '</div><div class="order-row"><strong>Carrots</strong><p class="collection-note">Purchased · 1 bag</p>' +
      rowActions("Move up", "Move down", "Move to section…") +
      "</div>" +
      section("Dairy", false) +
      rowActions(
        "Move section up",
        "Move section down",
        "Rename section",
        "Remove section",
      ) +
      '<div class="order-row"><strong>Milk</strong><p class="collection-note">Needed · 2 cartons</p>' +
      rowActions("Move up", "Move down", "Move to section…") +
      '</div><div class="actions end">' +
      button("Done", "primary") +
      "</div>",
  ),
  "Organize displays underlying order with status labels. Buttons and section selection are available to keyboard and touch users. No drag gesture is required.",
);
board(
  "tasks",
  "Your existing tasks",
  app(
    heading("Tasks", "1 open", button("New task", "primary", "plus")) +
      item("Water the plants", "Before leaving for the weekend.") +
      rowActions("View task history") +
      section("Completed · 1", false) +
      item("Return library books", "", true, { purchased: true }) +
      rowActions("View task history"),
    "Tasks",
  ),
  "Keep the familiar task layout and ordering. Move to Trash replaces permanent Delete. History includes a clearly labeled migration baseline, never fabricated earlier dates.",
);
board(
  "history",
  "See what changed",
  app(
    back("Groceries") +
      heading("Groceries", "History · Successful changes only") +
      '<div class="timeline-entry"><p class="event-meta">24 Oct 2026 · 10:42 · Owner</p><p class="event-title">Milk · Quantity changed</p><div class="compare"><div><div class="compare-label">Before</div>1 carton</div><div class="after"><div class="compare-label">After</div>2 cartons</div></div></div><div class="timeline-entry"><p class="event-meta">24 Oct 2026 · 10:40 · Owner</p><p class="event-title">Apples marked needed</p><p class="collection-note">Purchased → Needed</p></div><div class="timeline-entry"><p class="event-meta">24 Oct 2026 · 10:38 · Owner</p><p class="event-title">Section renamed</p><p class="collection-note">Chilled → Dairy</p></div>' +
      actions("Load older changes"),
  ),
  "History includes item and section changes. Viewing, failed attempts, and unsaved drafts produce no entries. Arbitrary revision rollback is deferred.",
);
board(
  "archive",
  "Keep it, outside active views",
  app(
    heading("Archive", "Read-only collections. Unarchive to use them again.") +
      collection("Holiday supplies", "Shopping list", "Archived", [
        "View",
        "History",
        "Unarchive",
        "Move to Trash",
      ]) +
      collection(
        "Summer camping trip",
        "Checklist run · Finished",
        "Archived",
        ["View", "History", "Unarchive", "Move to Trash"],
      ) +
      collection("Winter packing", "Checklist template", "Archived", [
        "View",
        "History",
        "Unarchive",
        "Move to Trash",
      ]),
  ),
  "Archived detail views show an Archived · Read-only badge and replace edit controls with Unarchive. Viewing and history remain available.",
);
board(
  "trash",
  "Restore what you removed",
  app(
    heading("Trash", "Removed content stays here until you erase it.") +
      collection(
        "Old grocery list",
        "Shopping list · Contains 4 items",
        "Trashed",
        ["View", "Restore", "Erase permanently"],
      ) +
      collection("Bread", "Item in Groceries", "Trashed", [
        "View",
        "Restore",
        "Erase permanently",
      ]) +
      notice(
        "Restore the parent first",
        "Restore Old grocery list before restoring one of its items.",
        "neutral",
      ) +
      notice(
        "Milk restored to Unsectioned",
        "Its former section no longer exists. Its content and completion state were preserved.",
      ),
  ),
  "Trashed detail views are read-only, with History, Restore, and Erase permanently. Restoring a collection preserves its prior archive/finished state and leaves individually trashed children in Trash.",
);
board(
  "reset",
  "Reset a shopping list",
  dialog(
    "Ready for another trip?",
    '<p>Mark the 2 purchased items in Groceries as needed again?</p><div class="reference">Carrots · Yogurt</div><p>Each item returns to its saved manual position. Nothing is removed.</p>',
    "Mark as needed",
    { symbol: "shopping" },
  ),
  "Bulk reset requires confirmation. While saving, disable repeat actions and retain the last confirmed state. Success records the changes once.",
  { context: "Confirmation" },
);
board(
  "erase",
  "Permanent erasure, with a clear boundary",
  dialog(
    "Erase Camping packing permanently?",
    '<p>This cannot be undone through Trash.</p><div class="reference">Camping packing · Checklist template</div><p>Erases its sections, all items (including individually trashed items), and associated content history.</p><p><strong>Existing runs keep their independent copies.</strong></p><p>Encrypted backup copies expire under the seven-day retention policy. Recovery reapplies subsequent erasures before reopening the app.</p>',
    "Erase permanently",
    { danger: true, symbol: "trash" },
  ),
  "Only available from Trash. Item erasure also removes its content from parent history. Cancel receives the initial focus; failure retains a safe retry.",
  { context: "Destructive confirmation" },
);
board(
  "empty",
  "Empty is an invitation to begin",
  app(
    heading("Shopping", "Lists to use again and again.") +
      '<div class="empty"><div class="empty-icon">' +
      icon("shopping") +
      "</div><h2>No shopping lists yet.</h2><p>Create a list for groceries or another regular errand.</p>" +
      button("New shopping list", "primary", "plus") +
      '</div><div class="substate"><h2>A template without items</h2><p class="description">Build it at your own pace. Add at least one item before starting a run.</p>' +
      button("Add item", "primary", "plus") +
      " " +
      button("Start run", "pending", "", true) +
      "</div>",
  ),
  "Show empty states only after successful loading. Runs, Archive, and Trash get corresponding empty messages; an empty run still finishes explicitly.",
);
board(
  "loading-errors",
  "Clear loading and failure states",
  app(
    heading("Groceries") +
      '<div class="notice"><span class="loader"></span><div><strong>Loading your list…</strong>The server may take a moment to start.</div></div><div class="skeleton"></div><div class="skeleton"></div><div class="substate">' +
      notice(
        "Couldn’t load this list",
        "Check your connection and try again.",
        "error",
      ) +
      button("Try again", "primary") +
      '</div><div class="substate">' +
      notice(
        "Couldn’t mark Milk as purchased",
        "The last saved state is unchanged.",
        "error",
      ) +
      actions("Retry update") +
      "</div>",
  ),
  "These are separate drawn states. Never show a false empty result, completed check, or success message before the server confirms it. MVP 2 requires internet access.",
);
board(
  "conflict",
  "Keep your draft when changes conflict",
  app(
    back("Groceries") +
      heading("This item changed", "Another tab saved a newer version.") +
      notice(
        "Your changes have not been saved",
        "Review the latest version before editing and saving again.",
        "error",
      ) +
      '<div class="compare"><div><div class="compare-label">Your draft</div><strong>Milk</strong><p>3 cartons</p></div><div class="after"><div class="compare-label">Latest saved</div><strong>Milk</strong><p>2 cartons</p></div></div><div class="actions end">' +
      button("Keep draft open") +
      button("Review latest version", "primary") +
      "</div>",
  ),
  "There is no blind-overwrite action. Preserve drafts if content was trashed or erased elsewhere. Reorder and reset conflicts also require reviewing current state.",
);
board(
  "expiry-validation",
  "Expiry, validation, and unsaved work",
  app(
    heading("Continue editing") +
      notice(
        "Your session expired",
        "Sign in again with your approved Google account. Keep this tab open to retain the unsaved draft.",
        "error",
      ) +
      button("Continue with Google") +
      '<div class="substate">' +
      field("Name *", "", "Enter a name. Whitespace alone is not valid.", {
        invalid: true,
        counter: "0 / 200",
      }) +
      '</div><div class="substate"><h2>Discard unsaved changes?</h2><p class="description">Your draft has not been saved.</p>' +
      actions("Keep editing", "Discard changes") +
      "</div>",
  ),
  "Expiry hides saved private data; a draft returns only after owner sign-in. Drafts stay in memory and are lost on reload or tab closure. The Google control here is a placement placeholder; the existing branded authentication UI remains unchanged.",
);

const document = (title, body, pageClass = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title><style>${css}</style></head><body class="${pageClass}">${body}</body></html>`;
const renderBoard = (b, index) =>
  `<section id="${b.id}" class="board${b.wide ? " wide" : ""}"><div class="board-header"><h2>${String(index + 1).padStart(2, "0")} · ${escape(b.title)}</h2><span>${escape(b.context)}</span></div>${b.content}<p class="board-note">${escape(b.note)}</p></section>`;
const reviewHeader = `<header class="review-header"><div class="eyebrow">MVP 2 · Design gate 2 · Awaiting owner review</div><h1>Make room for the everyday.</h1><p>Shopping lists that stay useful. Checklists that start fresh. History that helps you recover.</p><p>Static visual mockups following the approved wireframes. Controls are presentation-only; all content is synthetic. No scripts, external requests, login, or saved data.</p><nav class="review-nav" aria-label="Mockup index">${boards.map((b, i) => `<a href="#${b.id}">${String(i + 1).padStart(2, "0")} ${escape(b.title)}</a>`).join("")}</nav></header>`;
const footer =
  '<footer class="review-footer"><p><a href="MOCKUPS.md">Visual review notes and previews</a> · <a href="wireframes.html">Approved wireframes</a> · <a href="../../docs/mvp-2-plan.md">Accepted scope</a></p><p>Next: owner approval → standalone local prototype → owner approval → production implementation.</p></footer>';
const outputs = {
  "mockups.html": document(
    "Everyday lists — visual mockups",
    `${reviewHeader}<main class="gallery">${boards.map(renderBoard).join("")}</main>${footer}`,
  ),
  "mockup-shopping.html": document(
    "Groceries — desktop mockup",
    shopping(),
    "single-page",
  ),
  "mockup-shopping-mobile.html": document(
    "Groceries — phone mockup",
    shopping(true),
    "mobile-page",
  ),
  "mockup-template.html": document(
    "Pasta dinner template — mockup",
    template(),
    "single-page",
  ),
  "mockup-run.html": document(
    "Cooking run — desktop mockup",
    run(),
    "single-page",
  ),
  "mockup-run-mobile.html": document(
    "Cooking run — phone mockup",
    run(true),
    "mobile-page",
  ),
  "mockup-form-mobile.html": document(
    "Shopping item — phone mockup",
    itemForm(true),
    "mobile-page",
  ),
  "mockup-recovery.html": document(
    "History, recovery, and conflicts — mockups",
    `<header class="review-header"><div class="eyebrow">MVP 2 · Static visual mockups</div><h1>A clear way back.</h1><p>History, retained content, and explicit permanent erasure.</p></header><main class="gallery">${boards.map((b, i) => (["history", "archive", "trash", "erase", "conflict"].includes(b.id) ? renderBoard(b, i) : "")).join("")}</main>${footer}`,
  ),
  "mockup-confirmations.html": document(
    "Everyday lists — confirmations",
    `<header class="review-header"><div class="eyebrow">MVP 2 · Static visual mockups</div><h1>Confirm the change.</h1></header><main class="gallery">${[
      [
        "Finish this run?",
        '<p>2 of 4 items are still unchecked. Finish anyway?</p><div class="reference">Pasta dinner — 24 Oct</div><p>You can reopen it later.</p>',
        "Finish run",
        {},
      ],
      [
        "Move Groceries to Trash?",
        "<p>Its contents will be hidden together. You can restore it later.</p>",
        "Move to Trash",
        { symbol: "trash" },
      ],
      [
        "Archive Camping packing?",
        "<p>Keep this template read-only outside active views. Existing runs remain available.</p>",
        "Archive",
        { symbol: "archive" },
      ],
      [
        "Remove Dairy?",
        "<p>Its items move to Unsectioned, preserving their relative order. No items are removed.</p>",
        "Remove section",
        {},
      ],
    ]
      .map(
        ([title, content, confirm, options]) =>
          `<section class="board"><div class="board-header"><h2>${escape(title)}</h2></div>${dialog(title, content, confirm, options)}</section>`,
      )
      .join("")}</main>${footer}`,
  ),
};
for (const [name, content] of Object.entries(outputs))
  writeFileSync(new URL(name, directory), content);
console.log(
  `Rendered ${boards.length} boards across ${Object.keys(outputs).length} standalone documents.`,
);
