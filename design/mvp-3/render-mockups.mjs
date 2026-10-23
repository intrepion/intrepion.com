// Design review only. Do not import this renderer into prototype or production code.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL(".", import.meta.url));
const source = readFileSync(dir + "wireframes.html", "utf8");
const css = readFileSync(dir + "mockups.css", "utf8");
const mark =
  '<svg viewBox="0 0 30 30" aria-hidden="true"><rect width="30" height="30" rx="9" fill="#185e52"/><path d="m8 15 5 5 9-11" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const primary = new Set([
  "Create household",
  "Review capacity",
  "Create invitation link",
  "Accept and join",
  "Invite a head",
  "Review my changes",
  "Confirm allocation",
  "Copy to Maple",
  "New shopping list",
  "Add item",
]);
const danger = new Set(["Confirm leave and close", "Erase permanently"]);
const dangerOutline = new Set([
  "Confirm removal",
  "Confirm leave",
  "Revoke invitation",
]);
const rowActions = new Set([
  "Open",
  "View usage",
  "Copy link",
  "My ceilings",
  "Remove head",
  "View",
  "View details",
  "View change",
  "Edit",
  "Edit mine",
  "Manage mine",
  "Review latest",
  "Review capacity",
  "Personal",
  "Sign in",
  "Retry",
  "Try another account",
  "Back to personal",
  "My households",
]);
const caution = new Set([
  "remove",
  "leave",
  "close",
  "allocation-blocked",
  "full",
  "invite-errors",
  "recovery",
]);
const householdTabs = new Set([
  "create",
  "invite",
  "heads",
  "ceilings",
  "remove",
  "leave",
  "close",
]);
const usageTabs = new Set([
  "capacity",
  "allocation",
  "allocation-blocked",
  "usage",
  "former",
  "closed",
  "mobile-capacity",
  "full",
]);
function button(label, extra = "") {
  const cls = danger.has(label)
    ? "danger"
    : dangerOutline.has(label)
      ? "danger-outline"
      : primary.has(label)
        ? "primary"
        : extra;
  return `<button type="button" class="button ${cls}" title="Static visual mockup">${label}</button>`;
}
const boards = [
  ...source.matchAll(
    /<section class="board" id="([^"]+)">([\s\S]*?)<\/section>/g,
  ),
].map(([, id, inner]) => {
  let html = inner;
  const title = html
    .match(/<h2>([\s\S]*?)<\/h2>/)[1]
    .replace(/\s+/g, " ")
    .trim();
  html = html.replace(
    /<div class="screen( mobile)?">/,
    `<div class="screen$1${caution.has(id) ? " caution" : ""}">`,
  );
  html = html.replace(
    /<div class="top">[\s\S]*?<\/div>/,
    `<div class="top"><div class="brand">${mark}<span>intrepion</span></div><div class="account"><span class="avatar">AL</span><span>Alex · Sign out</span></div></div>`,
  );
  html = html.replace(
    /<div class="space">Space: ([\s\S]*?) ▾<\/div>/,
    (_, name) =>
      `<div class="space"><div><small>Current space</small><button type="button" class="space-switch" title="Static visual mockup">${name}<span aria-hidden="true">⌄</span></button></div><span class="badge">${name === "Personal" ? "Private" : "Shared · Head"}</span></div>`,
  );
  html = html.replace(/<div class="tabs">[\s\S]*?<\/div>/, () => {
    const selected = usageTabs.has(id)
      ? "Usage"
      : householdTabs.has(id)
        ? "Household"
        : id === "shared" || id === "mobile"
          ? "Shopping"
          : "Tasks";
    const labels = ["Tasks", "Shopping", "Checklists", "Usage"];
    if (
      !["spaces", "capacity", "create", "copy", "former", "closed"].includes(id)
    )
      labels.push("Household");
    return `<div class="tabs" aria-label="Application navigation">${labels.map((label) => `<button type="button" class="nav-item${label === selected ? " selected" : ""}"${label === selected ? ' aria-current="page"' : ""} title="Static visual mockup">${label}</button>`).join("")}</div>`;
  });
  html = html.replace(
    /<span class="button">([\s\S]*?)<\/span\s*>/g,
    (_, label) => button(label.replace(/\s+/g, " ").trim()),
  );
  html = html.replace(/<span>([^<>]*)<\/span>/g, (all, label) =>
    rowActions.has(label)
      ? button(label, label === "Remove head" ? "danger-outline" : "quiet")
      : label === "Fits" || label === "Current"
        ? `<span class="badge">${label}</span>`
        : all,
  );
  html = html.replace(
    /<div class="label">Shopping lists \/ templates \/ runs<\/div>\s*<div class="field">[\s\S]*?<\/div>/g,
    '<div class="resource-fields"><div><div class="label">Shopping lists</div><div class="field">8</div></div><div><div class="label">Templates</div><div class="field">4</div></div><div><div class="label">Runs</div><div class="field">8</div></div></div>',
  );
  let field = 0;
  html = html.replace(
    /<div class="label">([\s\S]*?)<\/div>\s*<div class="field">([\s\S]*?)<\/div>/g,
    (_, label, value) => {
      const inputId = `${id}-field-${++field}`;
      value = value.replace(/\s+/g, " ").trim();
      const escaped = value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
      return (
        `<label class="label" for="${inputId}">${label}</label>` +
        (value.length > 52
          ? `<textarea class="field" id="${inputId}" readonly rows="3">${value}</textarea>`
          : `<input class="field" id="${inputId}" readonly value="${escaped}">`)
      );
    },
  );
  html = html.replace("☑ Rice", "✓ Rice").replaceAll("☐ ", "□ ");
  html = html.replace(
    /<strong>(□|✓) ([^<]*)<\/strong>/g,
    (_, state, title) =>
      `<div class="item-title"><button type="button" class="check-target${state === "✓" ? " purchased" : ""}" aria-label="${state === "✓" ? "Mark needed again" : "Mark purchased"}: ${title}" title="Static visual mockup">${state === "✓" ? "✓" : ""}</button><strong${state === "✓" ? ' class="purchased-title"' : ""}>${title}</strong></div>`,
  );
  if (id === "usage" || id === "mobile-capacity") {
    const summary =
      '<div class="usage-summary"><h4>Household capacity · example</h4><div class="meter-caption"><strong>350 of 500 retained items</strong><span>70% used</span></div><div class="meter" aria-hidden="true"><span style="width:70%"></span></div><div class="meter-caption"><strong>520 of 768 KiB retained</strong><span>Content + History</span></div><div class="meter" aria-hidden="true"><span style="width:67.71%"></span></div></div>';
    html = html.replace(/(<h3>[\s\S]*?<\/h3>)/, `$1${summary}`);
  }
  // Restore the approved Archive/Trash destinations in a quiet, consistent footer.
  if (html.includes('class="top"'))
    html = html.replace(
      /\s*<\/div>\s*<p class="note">/,
      '<div class="app-footer"><span>Archive</span><span>Trash</span><span>Refresh to see shared changes</span></div></div><p class="note">',
    );
  return {
    id,
    title,
    html: `<section class="board" id="${id}">${html}</section>`,
  };
});
if (boards.length !== 23)
  throw new Error("Expected the 23 approved wireframe panels");
function render(filename, title, ids, standalone = false) {
  const chosen = ids ? boards.filter((b) => ids.includes(b.id)) : boards;
  const nav = chosen.map((b) => `<a href="#${b.id}">${b.title}</a>`).join("");
  const output = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} — MVP 3 visual mockups</title><style>${css}</style></head><body${standalone ? ' class="standalone"' : ""}><header><p class="eyebrow">Design gate 2 · Visual mockups · Approved by owner</p><h1>${title}</h1><p>A familiar home for your lists, with clear boundaries around what is private, shared and contributed.</p><div class="review-notice"><strong>Static visual review.</strong> All people, dates and numerical allowances are examples, not approved pilot caps. Application controls are presentation only; gallery links navigate. No scripts, login, saved data or external requests.</div><p><a href="mockups.html">All 23 screens</a> · <a href="mockup-household.html">Household</a> · <a href="mockup-capacity.html">Capacity</a> · <a href="mockup-mobile.html">Phone</a> · <a href="mockup-closure.html">Departure &amp; closure</a></p><nav aria-label="Mockup index">${nav}</nav></header><main class="grid">${chosen.map((b) => b.html).join("")}</main><footer><p>Approved scope and wireframes remain the behavioral baseline. Review colors, typography, hierarchy, controls and clarity of consequences.</p><p>After visual approval: a separate server-free local prototype, followed by its own approval. These documents are not production or prototype UI code.</p></footer></body></html>`;
  writeFileSync(dir + filename, output);
}
render("mockups.html", "Everyday lists, together");
render(
  "mockup-household.html",
  "A shared space, clearly yours",
  ["shared", "heads"],
  true,
);
render(
  "mockup-capacity.html",
  "Know what you can use",
  ["capacity", "allocation", "allocation-blocked", "usage"],
  true,
);
render(
  "mockup-mobile.html",
  "Everyday lists on your phone",
  ["mobile", "mobile-capacity"],
  true,
);
render(
  "mockup-closure.html",
  "Leave with clear consequences",
  ["remove", "leave", "close", "former", "closed"],
  true,
);
console.log("Rendered 23 panels across five standalone design documents.");
