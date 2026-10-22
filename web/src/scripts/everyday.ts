import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  ChangeAction as Action,
  ChangeRequestSchema,
  CollectionKind as Kind,
  type ChangeRequest,
  type Collection,
  type ListItem,
  type ListSection,
  type HistoryEntry,
  type TrashedItem,
} from "../gen/life/v1/lists_pb";
import { Api, needsLogin } from "../lib/api";

type Hooks = {
  show(): void;
  tasks(): void;
  busy(value: boolean): void;
  expired(): void;
  announce(message: string): void;
  confirm(
    title: string,
    description: string,
    accept: string,
    cancel: string,
    reference?: string,
  ): Promise<boolean>;
};
type Fields = {
  title: string;
  notes: string;
  quantity: string;
  sectionId: string;
};
type Draft = {
  mode: "collection" | "item" | "run" | "section";
  id: string;
  original?: ListItem;
  section?: ListSection;
  fields: Fields;
  initial: string;
};
type Input = Omit<
  MessageInitShape<typeof ChangeRequestSchema>,
  "$typeName" | "$unknown"
>;
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(
  label: string,
  action: () => void,
  className = "",
  visibleLabel?: string,
) {
  const b = el("button", visibleLabel ?? label, className);
  if (visibleLabel) b.setAttribute("aria-label", label);
  b.type = "button";
  b.addEventListener("click", action);
  return b;
}

/** Production controller: server-acknowledged state, tab-local drafts and stable retry requests. */
export class Everyday {
  active = false;
  private collection?: Collection;
  private kind: Kind = Kind.SHOPPING;
  private finished = false;
  private history?: HistoryEntry[];
  private historyCursor = 0n;
  private area: "normal" | "archive" | "trash" = "normal";
  private trashedItems: TrashedItem[] = [];
  private trashCursor = "";
  private draft?: Draft;
  private pending?: ChangeRequest;
  private list: Collection[] = [];
  private listLoaded = false;
  private cursor = "";
  private problem = "";
  private working = false;
  private reviewed = false;
  constructor(
    private root: HTMLElement,
    private api: Api,
    private hooks: Hooks,
  ) {}
  dirty() {
    return (
      !!this.pending ||
      (!!this.draft && JSON.stringify(this.draft.fields) !== this.draft.initial)
    );
  }
  async leave() {
    return (
      !this.dirty() ||
      this.hooks.confirm(
        "Discard your changes?",
        "Your unsaved changes will be lost.",
        "Discard changes",
        "Keep editing",
      )
    );
  }
  reset() {
    this.active = false;
    this.listLoaded = false;
    this.collection = undefined;
    this.history = undefined;
    this.draft = undefined;
    this.pending = undefined;
    this.list = [];
    this.problem = "";
    this.root.replaceChildren();
  }
  suspend() {
    this.root.replaceChildren();
  }
  resume() {
    this.hooks.show();
    this.render();
  }
  async open(kind: "shopping" | "checklists" | "archive" | "trash") {
    this.area = kind === "archive" || kind === "trash" ? kind : "normal";
    this.kind =
      kind === "shopping"
        ? Kind.SHOPPING
        : kind === "checklists"
          ? Kind.TEMPLATE
          : Kind.UNSPECIFIED;
    this.finished = false;
    this.active = true;
    this.history = undefined;
    this.collection = undefined;
    this.draft = undefined;
    this.pending = undefined;
    this.problem = "";
    this.list = [];
    this.cursor = "";
    this.trashedItems = [];
    this.trashCursor = "";
    this.hooks.show();
    await this.load();
  }
  async taskHistory(id: string) {
    this.reset();
    this.active = true;
    this.kind = Kind.TASK;
    this.area = "normal";
    this.hooks.show();
    await this.run(async () => {
      this.collection = await this.api.lists.getCollection(
        { id },
        { timeoutMs: 90000 },
      );
      const page = await this.api.lists.listHistory(
        { collectionId: id },
        { timeoutMs: 90000 },
      );
      this.history = page.entries;
      this.historyCursor = page.nextBeforeSequence;
      this.render();
    });
  }
  private async run(work: () => Promise<void>) {
    if (this.working) return;
    this.working = true;
    this.hooks.busy(true);
    try {
      await work();
    } catch (error) {
      if (needsLogin(error)) {
        this.problem =
          "Your session expired before this action was confirmed. Your draft is preserved. Retry the same action after signing in.";
        this.hooks.expired();
        return;
      }
      this.problem =
        error instanceof ConnectError &&
        [Code.FailedPrecondition, Code.InvalidArgument, Code.NotFound].includes(
          error.code,
        )
          ? error.rawMessage
          : "The action could not be confirmed. Your draft and last confirmed state are unchanged.";
      this.render();
    } finally {
      this.working = false;
      this.hooks.busy(false);
    }
  }
  private async load(more = false) {
    await this.run(() => this.fetchList(more));
  }
  private async fetchList(more = false) {
    if (!more) this.listLoaded = false;
    this.problem = "";
    this.renderLoading();
    const page = await this.api.lists.listCollections(
      {
        kind: this.kind,
        finished: this.finished,
        archived: this.area === "archive",
        trashed: this.area === "trash",
        cursor: more ? this.cursor : "",
      },
      { timeoutMs: 90000 },
    );
    this.list = more ? [...this.list, ...page.collections] : page.collections;
    this.cursor = page.nextCursor;
    if (this.area === "trash") {
      const items = await this.api.lists.listTrashedItems(
        { cursor: more ? this.trashCursor : "" },
        { timeoutMs: 90000 },
      );
      this.trashedItems = more
        ? [...this.trashedItems, ...items.items]
        : items.items;
      this.trashCursor = items.nextCursor;
    }
    this.listLoaded = true;
    this.render();
  }
  private renderLoading() {
    this.root.replaceChildren(el("p", "Loading your lists…", "muted"));
  }
  private async detail(id: string) {
    await this.run(async () => {
      this.problem = "";
      this.renderLoading();
      this.collection = await this.api.lists.getCollection(
        { id },
        { timeoutMs: 90000 },
      );
      this.render();
    });
  }
  private request(action: Action, extra: Partial<Input> = {}): ChangeRequest {
    return create(ChangeRequestSchema, {
      operationId: crypto.randomUUID(),
      collectionId: this.collection?.id ?? crypto.randomUUID(),
      expectedRevision: this.collection?.revision ?? 0,
      action,
      ...extra,
    });
  }
  private async save(request: ChangeRequest) {
    // Retrying always sends exactly the request whose outcome was uncertain.
    this.pending = request;
    await this.run(async () => {
      const result = await this.api.lists.applyChange(request, {
        timeoutMs: 90000,
      });
      this.pending = undefined;
      this.draft = undefined;
      this.history = undefined;
      this.problem = "";
      this.collection = result.collection;
      if (request.action === Action.ERASE_COLLECTION) {
        this.list = this.list.filter((c) => c.id !== request.collectionId);
        this.trashedItems = this.trashedItems.filter(
          (i) => i.parent?.id !== request.collectionId,
        );
        await this.fetchList();
      } else this.render();
      this.hooks.announce("Saved.");
    });
  }
  private edit(mode: Draft["mode"], item?: ListItem) {
    const fields = {
      title:
        mode === "run"
          ? `${this.collection!.title} · ${new Date().toLocaleDateString()}`
          : mode === "item"
            ? (item?.title ?? "")
            : (this.collection?.title ?? ""),
      notes:
        mode === "run"
          ? ""
          : mode === "item"
            ? (item?.notes ?? "")
            : (this.collection?.notes ?? ""),
      quantity: item?.quantity ?? "",
      sectionId: item?.sectionId ?? "",
    };
    this.reviewed = false;
    this.draft = {
      mode,
      id: item?.id ?? crypto.randomUUID(),
      ...(item ? { original: item } : {}),
      fields,
      initial: JSON.stringify(fields),
    };
    this.problem = "";
    this.render();
    this.root.querySelector<HTMLInputElement>("input")?.focus();
  }
  private render() {
    this.root.replaceChildren();
    if (this.problem) {
      const box = el("div", "", "error");
      box.setAttribute("role", "alert");
      box.append(el("p", this.problem));
      if (this.pending)
        box.append(
          button("Retry action", () => void this.save(this.pending!)),
          button("Review latest", () => void this.review()),
        );
      else
        box.append(
          button(
            "Try again",
            () =>
              void (this.collection
                ? this.detail(this.collection.id)
                : this.load()),
          ),
        );
      this.root.append(box);
    }
    if (this.history) {
      this.renderHistory();
      return;
    }
    if (this.draft) {
      this.renderForm();
      return;
    }
    if (this.collection) {
      this.renderCollection();
      return;
    }
    if (this.area === "normal" && this.kind !== Kind.SHOPPING) {
      const tabs = el("div", "", "everyday-actions");
      for (const [label, kind, finished] of [
        ["Templates", Kind.TEMPLATE, false],
        ["Active runs", Kind.RUN, false],
        ["Finished runs", Kind.RUN, true],
      ] as const)
        tabs.append(
          button(label, () => {
            this.kind = kind;
            this.finished = finished;
            void this.load();
          }),
        );
      this.root.append(tabs);
    }
    const heading = el("div", "", "heading");
    heading.append(
      el(
        "h1",
        this.area === "archive"
          ? "Archive"
          : this.area === "trash"
            ? "Trash"
            : this.kind === Kind.SHOPPING
              ? "Shopping"
              : this.kind === Kind.TEMPLATE
                ? "Checklist templates"
                : this.finished
                  ? "Finished runs"
                  : "Active runs",
      ),
    );
    if (this.area === "normal" && this.kind !== Kind.RUN)
      heading.append(
        button(
          this.kind === Kind.SHOPPING ? "New shopping list" : "New template",
          () => this.edit("collection"),
          "primary",
        ),
      );
    this.root.append(heading);
    if (!this.listLoaded) return;
    if (!this.list.length)
      this.root.append(
        el(
          "p",
          "Nothing here yet. Create a list or start a run from a template.",
          "muted",
        ),
      );
    for (const c of this.list) {
      const card = el("article", "", "collection-card");
      card.append(
        button(
          `Open ${c.title}`,
          () => void this.detail(c.id),
          "collection-link",
        ),
        el(
          "p",
          this.kind === Kind.SHOPPING
            ? `${c.itemCount - c.completedCount} needed · ${c.completedCount} purchased`
            : `${c.completedCount} of ${c.itemCount} complete`,
          "muted",
        ),
      );
      this.root.append(card);
    }
    if (this.area === "trash") this.renderTrashedItems();
    if (this.cursor)
      this.root.append(button("Load more", () => void this.load(true)));
  }
  private writable() {
    const c = this.collection!;
    return !c.finished && !c.archived && !c.trashed && !c.erasurePending;
  }
  private async confirmed(
    action: Action,
    title: string,
    description: string,
    accept: string,
    extra: Partial<Input> = {},
  ) {
    if (
      await this.hooks.confirm(
        title,
        description,
        accept,
        "Cancel",
        this.collection!.title,
      )
    )
      await this.save(this.request(action, extra));
  }
  private editSection(section?: ListSection) {
    const fields = {
      title: section?.title ?? "",
      notes: "",
      quantity: "",
      sectionId: "",
    };
    this.draft = {
      mode: "section",
      id: section?.id ?? crypto.randomUUID(),
      ...(section ? { section } : {}),
      fields,
      initial: JSON.stringify(fields),
    };
    this.render();
    this.root.querySelector("input")?.focus();
  }
  private renderCollection() {
    const c = this.collection!;
    this.root.append(
      button(
        this.area === "trash"
          ? "← Back to Trash"
          : this.area === "archive"
            ? "← Back to Archive"
            : this.kind === Kind.TASK
              ? "← Back to tasks"
              : this.kind === Kind.SHOPPING
                ? "← Back to shopping"
                : "← Back to checklists",
        () => {
          if (this.pending) return;
          if (this.kind === Kind.TASK && this.area === "normal") {
            this.hooks.tasks();
            return;
          }
          this.collection = undefined;
          void this.load();
        },
        "quiet back",
      ),
    );
    const heading = el("div", "", "heading");
    heading.append(el("h1", c.title));
    if (c.kind !== Kind.TASK && this.writable())
      heading.append(button("Add item", () => this.edit("item"), "primary"));
    this.root.append(heading);
    const actions = el("div", "", "everyday-actions");
    actions.append(button("History", () => void this.loadHistory()));
    if (this.writable()) {
      actions.append(button("Edit collection", () => this.edit("collection")));
      if (c.kind !== Kind.TASK)
        actions.append(button("Add section", () => this.editSection()));
    }
    if (c.trashed)
      actions.append(
        button(
          "Restore collection",
          () => void this.save(this.request(Action.RESTORE_COLLECTION)),
        ),
        button(
          "Erase collection permanently",
          () =>
            void this.confirmed(
              Action.ERASE_COLLECTION,
              "Erase this collection permanently?",
              "This erases this collection, all its items (including items in Trash), sections and associated history. Independent runs keep their own copies. Backup copies expire within seven days; recovery reapplies erasures.",
              "Erase permanently",
            ),
          "danger",
        ),
      );
    else {
      if (c.archived)
        actions.append(
          button(
            "Unarchive collection",
            () => void this.save(this.request(Action.UNARCHIVE)),
          ),
        );
      else if (c.kind !== Kind.TASK)
        actions.append(
          button(
            "Archive collection",
            () =>
              void this.confirmed(
                Action.ARCHIVE,
                "Archive this collection?",
                "You can view it in Archive and unarchive it later. It will be read-only.",
                "Archive",
              ),
          ),
        );
      actions.append(
        button(
          "Move collection to Trash",
          () =>
            void this.confirmed(
              Action.TRASH_COLLECTION,
              "Move this collection to Trash?",
              "Its contents and history remain available. You can restore it later. Independent runs remain unchanged.",
              "Move to Trash",
            ),
        ),
      );
    }
    if (c.kind === Kind.SHOPPING && this.writable() && c.completedCount)
      actions.append(
        button(
          "Mark all purchased items as needed",
          () =>
            void this.confirmed(
              Action.RESET_PURCHASES,
              "Reset purchased items?",
              "All purchased items become needed again, preserving their manual order.",
              "Reset purchases",
            ),
        ),
      );
    if (c.erasurePending || this.pending)
      actions
        .querySelectorAll<HTMLButtonElement>("button")
        .forEach((button, index) => {
          if (index > 0) button.disabled = true;
        });
    this.root.append(actions);
    if (c.trashed) this.root.append(el("p", "In Trash · read-only", "muted"));
    else if (c.archived)
      this.root.append(el("p", "Archived · read-only", "muted"));
    else if (c.finished)
      this.root.append(el("p", "Finished · read-only", "muted"));
    if (c.erasurePending) {
      this.root.append(
        el(
          "p",
          "An erasure is pending. Retry that erasure before making other changes.",
          "error",
        ),
      );
      const pending = c.pendingErasure;
      if (pending)
        this.root.append(
          button(
            "Retry pending erasure",
            () =>
              void this.save(
                create(ChangeRequestSchema, {
                  operationId: pending.operationId,
                  collectionId: c.id,
                  expectedRevision: pending.expectedRevision,
                  action: pending.wholeCollection
                    ? Action.ERASE_COLLECTION
                    : Action.ERASE_ITEM,
                  targetId: pending.targetId,
                }),
              ),
          ),
        );
    }
    if (c.kind === Kind.TEMPLATE) {
      const start = button("Start run", () => this.edit("run"), "primary");
      start.disabled =
        !c.items.some((i) => !i.trashed) ||
        c.archived ||
        c.trashed ||
        c.erasurePending ||
        !!this.pending;
      this.root.append(start);
    }
    if (c.kind === Kind.RUN) {
      this.root.append(
        el("p", `${c.completedCount} of ${c.itemCount} complete`, "muted"),
      );
      const progress = el("progress");
      progress.max = c.itemCount || 1;
      progress.value = c.completedCount;
      progress.setAttribute("aria-label", "Checklist progress");
      this.root.append(progress);
      const finish = button(
        c.finished ? "Reopen run" : "Finish run",
        () =>
          void (async () => {
            if (
              !c.finished &&
              c.completedCount < c.itemCount &&
              !(await this.hooks.confirm(
                "Finish with unchecked items?",
                "Unchecked items will stay unchecked. You can reopen this run later.",
                "Finish run",
                "Keep working",
                c.title,
              ))
            )
              return;
            await this.save(
              this.request(c.finished ? Action.REOPEN_RUN : Action.FINISH_RUN),
            );
          })(),
      );
      finish.disabled =
        c.archived || c.trashed || c.erasurePending || !!this.pending;
      this.root.append(finish);
    }
    if (c.notes) this.root.append(el("p", c.notes, "everyday-notes"));
    if (c.kind !== Kind.TASK && !c.items.some((i) => !i.trashed))
      this.root.append(el("p", "No items yet. Add what you need.", "muted"));
    for (const section of [{ id: "", title: "Unsectioned" }, ...c.sections]) {
      const members = c.items.filter(
        (i) => !i.trashed && i.sectionId === section.id,
      );
      if (!members.length && !section.id) continue;
      if (c.sections.length)
        this.root.append(el("h2", section.title, "section-title"));
      if (section.id && this.writable()) {
        const tools = el("div", "", "everyday-actions");
        const saved = c.sections.find((s) => s.id === section.id)!;
        const index = c.sections.indexOf(saved);
        tools.append(
          button(
            `Rename section ${section.title}`,
            () => this.editSection(saved),
            "",
            "Rename",
          ),
        );
        for (const [label, delta] of [
          ["up", -1],
          ["down", 1],
        ] as const) {
          const move = button(
            `Move section ${section.title} ${label}`,
            () =>
              void this.save(
                this.request(Action.MOVE_SECTION, {
                  targetId: section.id,
                  position: index + delta,
                }),
              ),
            "",
            label === "up" ? "↑" : "↓",
          );
          move.disabled =
            index + delta < 0 || index + delta >= c.sections.length;
          tools.append(move);
        }
        tools.append(
          button(
            `Remove section ${section.title}`,
            () =>
              void this.confirmed(
                Action.REMOVE_SECTION,
                "Remove this section?",
                "Active items move to the end of Unsectioned in their current order. Trashed items keep their former section until restored.",
                "Remove section",
                { targetId: section.id },
              ),
            "",
            "Remove",
          ),
        );
        this.root.append(tools);
      }
      // Presentation groups purchased items; stored manual positions are unchanged.
      for (const i of c.kind === Kind.SHOPPING
        ? [
            ...members.filter((i) => !i.completed),
            ...members.filter((i) => i.completed),
          ]
        : members)
        this.root.append(this.itemRow(i));
    }
    if (this.pending) this.freeze();
  }
  private itemRow(item: ListItem) {
    const row = el("article", "", `task${item.completed ? " done" : ""}`);
    const toggle = button(
      "",
      () =>
        void this.save(
          this.request(Action.UPDATE_ITEM, {
            item: { ...item, completed: !item.completed },
          }),
        ),
      "task-toggle",
    );
    toggle.setAttribute("role", "checkbox");
    toggle.setAttribute("aria-checked", String(item.completed));
    toggle.setAttribute(
      "aria-label",
      this.collection!.kind === Kind.SHOPPING
        ? `Mark ${item.title} ${item.completed ? "needed" : "purchased"}`
        : `${item.completed ? "Reopen" : "Complete"} ${item.title}`,
    );
    toggle.append(el("span", item.completed ? "✓" : ""));
    const copy = el("div", "", "task-copy");
    copy.append(el("p", item.title, "task-title"));
    if (item.quantity) copy.append(el("p", item.quantity, "muted"));
    if (item.notes) copy.append(el("p", item.notes, "everyday-notes"));
    toggle.disabled =
      this.collection!.finished ||
      this.collection!.archived ||
      this.collection!.trashed ||
      this.collection!.erasurePending ||
      !!this.pending;
    if (this.collection!.kind !== Kind.TEMPLATE) row.append(toggle);
    else row.classList.add("template-item");
    row.append(copy);
    if (this.writable()) {
      const actions = el("div", "", "task-actions");
      actions.append(
        button(
          `Edit item: ${item.title}`,
          () => this.edit("item", item),
          "quiet",
          "Edit",
        ),
        button(
          `Move item to Trash: ${item.title}`,
          () =>
            void this.confirmed(
              Action.TRASH_ITEM,
              "Move this item to Trash?",
              "Its history is retained and you can restore it later.",
              "Move to Trash",
              { targetId: item.id },
            ),
          "quiet",
          "Move to Trash",
        ),
      );
      const members = this.collection!.items.filter(
        (i) => !i.trashed && i.sectionId === item.sectionId,
      );
      const index = members.findIndex((i) => i.id === item.id);
      for (const [label, delta] of [
        ["up", -1],
        ["down", 1],
      ] as const) {
        const move = button(
          `Move ${item.title} ${label}`,
          () =>
            void this.save(
              this.request(Action.MOVE_ITEM, {
                targetId: item.id,
                position: index + delta,
              }),
            ),
          "quiet",
          label === "up" ? "↑" : "↓",
        );
        move.disabled = index + delta < 0 || index + delta >= members.length;
        actions.append(move);
      }
      row.append(actions);
    }
    return row;
  }
  private renderForm() {
    const d = this.draft!;
    const form = el("form", "", "editor");
    form.noValidate = true;
    form.append(
      el(
        "h1",
        d.mode === "section"
          ? d.section
            ? "Rename section"
            : "Add section"
          : d.mode === "run"
            ? "Start run"
            : d.mode === "item"
              ? d.original
                ? "Edit item"
                : "Add item"
              : this.collection
                ? "Edit collection"
                : this.kind === Kind.SHOPPING
                  ? "New shopping list"
                  : "New template",
      ),
    );
    if (this.reviewed && this.collection) {
      const saved = el("aside", "", "saved-comparison");
      saved.append(el("h2", "Latest saved version"));
      const item =
        d.mode === "item"
          ? this.collection.items.find((i) => i.id === d.id)
          : undefined;
      const latest =
        d.mode === "section"
          ? this.collection.sections.find((s) => s.id === d.id)
          : d.mode === "item"
            ? item
            : this.collection;
      saved.append(el("p", latest?.title ?? "This item no longer exists."));
      if (latest && "notes" in latest && latest.notes)
        saved.append(el("p", latest.notes, "everyday-notes"));
      if (item) {
        if (this.collection.kind === Kind.SHOPPING)
          saved.append(el("p", `Quantity: ${item.quantity || "—"}`));
        saved.append(
          el(
            "p",
            `Section: ${item.sectionId ? (this.collection.sections.find((section) => section.id === item.sectionId)?.title ?? "Former section") : "Unsectioned"}`,
          ),
        );
        if (this.collection.kind !== Kind.TEMPLATE)
          saved.append(
            el(
              "p",
              `Progress: ${this.collection.kind === Kind.SHOPPING ? (item.completed ? "Purchased" : "Needed") : item.completed ? "Complete" : "Incomplete"}`,
            ),
          );
        if (item.trashed) saved.append(el("p", "In Trash"));
      }
      this.root.append(saved);
    }
    for (const [key, label, limit] of [
      ["title", "Name", 200],
      ["quantity", "Quantity", 100],
      ["notes", "Notes", 10000],
    ] as const) {
      if (
        (key === "quantity" &&
          (d.mode !== "item" || this.collection?.kind !== Kind.SHOPPING)) ||
        (key === "notes" && (d.mode === "run" || d.mode === "section"))
      )
        continue;
      const id = `everyday-${key}`;
      const labelRow = el("div", "", "field-label");
      const l = el("label", label);
      l.htmlFor = id;
      const count = el(
        "span",
        `${[...d.fields[key]].length} / ${limit.toLocaleString("en-US")}`,
        "muted small",
      );
      labelRow.append(l, count);
      const input = key === "notes" ? el("textarea") : el("input");
      input.id = id;
      input.name = key;
      input.value = d.fields[key];
      input.addEventListener("input", () => {
        d.fields[key] = input.value;
        count.textContent = `${[...input.value].length} / ${limit.toLocaleString("en-US")}`;
      });
      form.append(labelRow, input);
    }
    if (d.mode === "item") {
      const label = el("label", "Section");
      label.htmlFor = "everyday-section";
      const select = el("select");
      select.id = "everyday-section";
      for (const section of [
        { id: "", title: "Unsectioned" },
        ...this.collection!.sections,
      ]) {
        const option = el("option", section.title);
        option.value = section.id;
        select.append(option);
      }
      if (
        d.fields.sectionId &&
        !this.collection!.sections.some(
          (section) => section.id === d.fields.sectionId,
        )
      ) {
        const missing = el("option", "Former section — choose a destination");
        missing.value = d.fields.sectionId;
        missing.disabled = true;
        select.append(missing);
      }
      select.value = d.fields.sectionId;
      select.addEventListener("change", () => {
        d.fields.sectionId = select.value;
      });
      form.append(label, select);
    }
    const errors = el("p", "", "field-error");
    errors.setAttribute("role", "alert");
    const actions = el("div", "", "form-actions");
    actions.append(
      button(
        "Cancel",
        () =>
          void (async () => {
            if (!(await this.leave())) return;
            this.draft = undefined;
            this.pending = undefined;
            this.problem = "";
            this.render();
          })(),
      ),
    );
    const submit = el(
      "button",
      d.mode === "run" ? "Start run" : "Save",
      "primary",
    );
    submit.type = "submit";
    actions.append(submit);
    form.append(errors, actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.working) return;
      if (this.pending) {
        void this.save(this.pending);
        return;
      }
      if (
        !d.fields.title.trim() ||
        [...d.fields.title].length > 200 ||
        [...d.fields.notes].length > 10000 ||
        [...d.fields.quantity].length > 100
      ) {
        errors.textContent =
          "Enter a name of 1–200 characters, quantity up to 100 and notes up to 10,000.";
        form.querySelector("input")?.focus();
        return;
      }
      void this.save(
        d.mode === "section"
          ? this.request(
              d.section ? Action.RENAME_SECTION : Action.CREATE_SECTION,
              { section: { id: d.id, title: d.fields.title } },
            )
          : d.mode === "run"
            ? this.request(Action.START_RUN, {
                collectionId: d.id,
                sourceId: this.collection!.id,
                details: { title: d.fields.title },
              })
            : d.mode === "collection"
              ? this.request(
                  this.collection
                    ? Action.UPDATE_METADATA
                    : Action.CREATE_COLLECTION,
                  {
                    collectionId: this.collection?.id ?? d.id,
                    details: {
                      kind: this.kind,
                      title: d.fields.title,
                      notes: d.fields.notes,
                      completed: this.collection?.completed ?? false,
                    },
                  },
                )
              : this.request(
                  d.original ? Action.UPDATE_ITEM : Action.CREATE_ITEM,
                  {
                    item: {
                      id: d.id,
                      ...d.fields,
                      completed: d.original?.completed ?? false,
                      position: d.original?.position ?? 0,
                    },
                  },
                ),
      );
    });
    this.root.append(form);
    if (this.pending) this.freeze();
  }
  private renderTrashedItems() {
    this.root.append(el("h2", "Individual items", "section-title"));
    if (!this.trashedItems.length)
      this.root.append(el("p", "No individual items in Trash.", "muted"));
    for (const entry of this.trashedItems) {
      const item = entry.item!;
      const parent = entry.parent!;
      const card = el("article", "", "collection-card");
      card.append(
        el("p", item.title),
        el("p", `From ${parent.title}`, "muted"),
      );
      card.append(
        button(
          `Open parent ${parent.title}`,
          () => void this.detail(parent.id),
        ),
      );
      const restore = button(
        `Restore item: ${item.title}`,
        () => void this.actOnTrashedItem(entry, false),
        "",
        "Restore",
      );
      restore.disabled =
        parent.trashed ||
        parent.archived ||
        parent.finished ||
        parent.erasurePending;
      card.append(restore);
      if (restore.disabled)
        card.append(
          el(
            "p",
            "Restore, unarchive or reopen the parent collection before restoring this item.",
            "muted small",
          ),
        );
      const erase = button(
        `Erase item permanently: ${item.title}`,
        () => void this.actOnTrashedItem(entry, true),
        "danger",
        "Erase permanently",
      );
      erase.disabled = parent.erasurePending;
      card.append(erase);
      this.root.append(card);
    }
    if (this.trashCursor)
      this.root.append(
        button(
          "Load more trashed items",
          () =>
            void this.run(async () => {
              const page = await this.api.lists.listTrashedItems(
                { cursor: this.trashCursor },
                { timeoutMs: 90000 },
              );
              this.trashedItems.push(...page.items);
              this.trashCursor = page.nextCursor;
              this.render();
            }),
        ),
      );
  }
  private async actOnTrashedItem(entry: TrashedItem, erase: boolean) {
    let parent: Collection | undefined;
    await this.run(async () => {
      parent = await this.api.lists.getCollection(
        { id: entry.parent!.id },
        { timeoutMs: 90000 },
      );
    });
    if (!parent) return;
    if (parent.revision !== entry.parent!.revision) {
      this.problem =
        "This collection changed. Reload Trash and review the latest item before trying again.";
      this.render();
      return;
    }
    const item = entry.item!;
    if (erase) {
      if (
        !(await this.hooks.confirm(
          "Erase this item permanently?",
          "This erases this item and its entries in the parent history. Independent runs retain their copies. Backup copies expire within seven days; recovery reapplies erasures.",
          "Erase permanently",
          "Cancel",
          item.title,
        ))
      )
        return;
    } else if (
      item.sectionId &&
      !parent.sections.some((section) => section.id === item.sectionId)
    ) {
      if (
        !(await this.hooks.confirm(
          "Restore to Unsectioned?",
          "Its former section no longer exists. This item will return to the end of Unsectioned, keeping its notes, quantity and progress.",
          "Restore item",
          "Cancel",
          item.title,
        ))
      )
        return;
    }
    this.collection = parent;
    await this.save(
      this.request(erase ? Action.ERASE_ITEM : Action.RESTORE_ITEM, {
        targetId: item.id,
      }),
    );
    if (erase && !this.pending) {
      this.collection = undefined;
      await this.load();
    }
  }
  private async loadHistory(more = false) {
    await this.run(async () => {
      const page = await this.api.lists.listHistory(
        {
          collectionId: this.collection!.id,
          beforeSequence: more ? this.historyCursor : 0n,
        },
        { timeoutMs: 90000 },
      );
      this.history = more ? [...this.history!, ...page.entries] : page.entries;
      this.historyCursor = page.nextBeforeSequence;
      this.render();
    });
  }
  private renderHistory() {
    this.root.append(
      button(
        "Back to collection",
        () => {
          this.history = undefined;
          this.render();
        },
        "quiet back",
      ),
      el("h1", `History · ${this.collection!.title}`),
    );
    if (!this.history!.length)
      this.root.append(el("p", "No history available.", "muted"));
    for (const entry of this.history!) {
      const card = el("article", "", "history-entry");
      card.append(
        el("h2", entry.action),
        el("p", entry.targetTitle),
        el(
          "p",
          `${entry.actor} · ${new Date(Number(entry.occurredAt) * 1000).toLocaleString()}`,
          "muted small",
        ),
      );
      const before = JSON.parse(entry.beforeJson) as Record<
        string,
        unknown
      > | null;
      const after = JSON.parse(entry.afterJson) as Record<
        string,
        unknown
      > | null;
      for (const key of new Set([
        ...Object.keys(before ?? {}),
        ...Object.keys(after ?? {}),
      ])) {
        const previous = before?.[key];
        const next = after?.[key];
        if (JSON.stringify(previous) === JSON.stringify(next)) continue;
        const line = el("p", "", "history-value");
        line.append(
          el("strong", `${key}: `),
          el(
            "span",
            `${previous === undefined ? "—" : String(previous)} → ${next === undefined ? "—" : String(next)}`,
          ),
        );
        card.append(line);
      }
      this.root.append(card);
    }
    if (this.historyCursor)
      this.root.append(
        button("Load older history", () => void this.loadHistory(true)),
      );
  }
  private freeze() {
    this.root
      .querySelectorAll<
        | HTMLInputElement
        | HTMLButtonElement
        | HTMLTextAreaElement
        | HTMLSelectElement
      >(
        "form input,form textarea,form select,form button,.task button,.heading button,.back",
      )
      .forEach((node) => {
        node.disabled = true;
      });
  }
  private async review() {
    await this.run(async () => {
      const pending = this.pending;
      if (!pending) return;
      let latest: Collection;
      try {
        latest = await this.api.lists.getCollection(
          { id: pending.collectionId },
          { timeoutMs: 90000 },
        );
      } catch (error) {
        if (!(error instanceof ConnectError && error.code === Code.NotFound))
          throw error;
        if (pending.action === Action.START_RUN)
          latest = await this.api.lists.getCollection(
            { id: pending.sourceId },
            { timeoutMs: 90000 },
          );
        else if (pending.action === Action.CREATE_COLLECTION) {
          this.collection = undefined;
          this.pending = undefined;
          this.problem =
            "No saved collection was found. Your draft is preserved; review it before saving.";
          this.render();
          return;
        } else throw error;
      }
      this.collection = latest;
      if (this.draft?.mode === "item") {
        const original = latest.items.find((i) => i.id === this.draft!.id);
        if (original) this.draft.original = original;
      }
      if (
        pending.action === Action.START_RUN &&
        latest.id === pending.collectionId
      )
        this.draft = undefined;
      this.pending = undefined;
      this.reviewed = true;
      this.problem =
        "Latest saved version loaded. Your draft is preserved. Review it before saving.";
      this.render();
    });
  }
}
