// Static design artifacts only; never import into prototype or production.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL(".", import.meta.url));
const source = readFileSync(dir + "wireframes.html", "utf8");
const css = readFileSync(dir + "mockups.css", "utf8");
const mark =
  '<svg viewBox="0 0 30 30" aria-hidden="true"><rect width="30" height="30" rx="9" fill="#185e52"/><path d="m8 15 5 5 9-11" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const primary = new Set([
  "Continue with Google",
  "Create household",
  "Review household",
  "Review invitation",
  "Send invitation",
  "Review and send",
  "Create account and join",
  "Accept and join",
  "Open household",
  "Switch Google account",
  "Review and send again",
  "Save safety settings",
  "Review changes",
  "Apply reviewed change",
  "Review latest",
  "Sign in again",
  "Try again",
]);
const destructive = new Set(["Suspend account", "Pause growth"]);
const dangerOutline = new Set(["Revoke", "Remove head", "Leave household"]);
const caution = new Set([
  "wrong-account",
  "unavailable",
  "paused-join",
  "send-again",
  "inviter-removed",
  "session-recovery",
  "admin-confirm",
  "admin-pause",
  "admin-feedback",
  "admin-recovery",
]);
const danger = new Set(["blocked-save", "admin-suspend"]);
const boards = [
  ...source.matchAll(
    /<section class="board" id="([^"]+)">([\s\S]*?)<\/section>/g,
  ),
].map(([, id, inner]) => {
  const title = inner
    .match(/<h2>([\s\S]*?)<\/h2>/)[1]
    .replace(/\s+/g, " ")
    .trim();
  let html = inner.replace(
    '<div class="screen">',
    `<div class="screen${caution.has(id) ? " caution" : ""}${danger.has(id) ? " danger-state" : ""}">`,
  );
  html = html.replaceAll(
    "<strong>intrepion</strong>",
    `<strong class="brand">${mark}<span>intrepion</span></strong>`,
  );
  html = html.replace(
    /<div class="space">Space: ([\s\S]*?) ▾<\/div>/,
    (_, s) => {
      const parts = s.split(" · ");
      return `<div class="space"><div><small>Current space</small><strong>${parts[0]} <span aria-hidden="true">⌄</span></strong></div><span class="badge">${parts.slice(1).join(" · ")}</span></div>`;
    },
  );
  html = html.replace(/<div class="tabs">[\s\S]*?<\/div>/, () => {
    const labels = [
      "Tasks",
      "Shopping",
      "Checklists",
      "Households",
      ...(id.startsWith("admin-") ? ["Admin"] : []),
    ];
    const selected = id.startsWith("admin-") ? "Admin" : "Households";
    return `<div class="tabs" aria-label="Application navigation">${labels.map((s) => `<button type="button" disabled${s === selected ? ' class="selected" aria-current="page"' : ""}>${s}</button>`).join("")}</div>`;
  });
  html = html.replace(
    /<button type="button" disabled>([\s\S]*?)<\/button\s*>/g,
    (_, text) => {
      const label = text.replace(/\s+/g, " ").trim();
      const cls = destructive.has(label)
        ? "destructive"
        : dangerOutline.has(label)
          ? "danger-outline"
          : primary.has(label)
            ? "primary"
            : label.includes("— wait")
              ? "waiting"
              : "";
      return `<button type="button" disabled${cls ? ` class="${cls}"` : ""}>${label}</button>`;
    },
  );
  html = html.replace(
    /<input\s+[^>]*value="[^"]*@example.invalid"[^>]*>/g,
    (tag) => tag.replace("<input", '<input class="identity"'),
  );
  if (id === "admin-overview")
    html = html.replace(
      "<p>80% warning reached</p>",
      '<div class="progress" aria-hidden="true"><span></span></div><p>80% warning reached</p>',
    );
  return {
    id,
    title,
    html: `<section class="board" id="${id}">${html}</section>`,
  };
});
if (boards.length !== 28)
  throw new Error("Expected 28 approved wireframe panels");
const notice =
  '<div class="notice"><strong>Static visual review.</strong> People, addresses and usage are synthetic. Buttons are presentation only; fields are read-only examples. No login, sending, saved data or external resources. Resource thresholds remain subject to sizing.</div>';
function document(title, body, cls = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · intrepion MVP 3.1</title><style>${css}</style></head><body class="${cls}">${body}<footer><p class="note">MVP 3.1 · Design gate 2 · Awaiting owner approval. The standalone prototype follows approved mockups.</p></footer></body></html>`;
}
const nav = boards.map((b) => `<a href="#${b.id}">${b.title}</a>`).join("");
writeFileSync(
  dir + "mockups.html",
  document(
    "Visual mockups",
    `<header><p class="eyebrow">Design gate 2 · Visual mockups</p><h1>Your everyday lists. Your people, invited.</h1><p>Emailed invitations, simpler households and a private owner overview.</p>${notice}<p>Focused views: <a href="mockup-households.html">Households</a> · <a href="mockup-invitation.html">Join a household</a> · <a href="mockup-admin.html">Owner overview</a> · <a href="mockup-email.html">Invitation email</a></p><nav class="index" aria-label="Mockup index">${nav}</nav></header><main class="grid">${boards.map((b) => b.html).join("")}</main>`,
  ),
);
for (const [file, id, cls] of [
  ["households", "households", ""],
  ["invitation", "join-new", "invitation"],
  ["admin", "admin-overview", ""],
  ["email", "email", "invitation"],
]) {
  const b = boards.find((b) => b.id === id);
  writeFileSync(
    dir + `mockup-${file}.html`,
    document(
      b.title,
      `<header><p class="eyebrow">MVP 3.1 · Static visual review</p><h1>${b.title}</h1><p><a href="mockups.html#${id}">Back to all 28 mockups</a></p></header><main>${b.html}</main>`,
      `single ${cls}`,
    ),
  );
}
console.log("Rendered 28 mockups and four focused views.");
