// Throwaway synthetic state. No production types, API, storage, or credentials.
export type Kind = "task" | "shopping" | "template" | "run";
export type DemoItem = {
  id: string;
  title: string;
  notes: string;
  quantity: string;
  section: string;
  completed: boolean;
  trashed: boolean;
};
export type DemoSection = { id: string; title: string };
export type Collection = {
  id: string;
  kind: Kind;
  title: string;
  notes: string;
  completed: boolean;
  archived: boolean;
  trashed: boolean;
  finished: boolean;
  created: number;
  revision: number;
  sourceId?: string;
  sourceTitle?: string;
  sections: DemoSection[];
  items: DemoItem[];
};
export type Change = {
  id: string;
  parent: string;
  target: string;
  title: string;
  action: string;
  at: string;
  before: unknown;
  after: unknown;
};
export type DemoState = {
  collections: Collection[];
  history: Change[];
  erasedIds: string[];
};

export const uid = () => crypto.randomUUID();
export const copy = <T>(value: T): T => structuredClone(value);
export const baseCollection = (kind: Kind, title: string): Collection => ({
  id: uid(),
  kind,
  title,
  notes: "",
  completed: false,
  archived: false,
  trashed: false,
  finished: false,
  created: Date.now(),
  revision: 1,
  sections: [],
  items: [],
});
export const baseItem = (
  title: string,
  section = "",
  notes = "",
  quantity = "",
): DemoItem => ({
  id: uid(),
  title,
  section,
  notes,
  quantity,
  completed: false,
  trashed: false,
});
export const collectionValues = (c: Collection) => ({
  title: c.title,
  notes: c.notes,
  completed: c.completed,
  archived: c.archived,
  trashed: c.trashed,
  finished: c.finished,
});
export function change(
  s: DemoState,
  c: Collection,
  target: string,
  title: string,
  action: string,
  before: unknown,
  after: unknown,
): void {
  const historicalValue = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "id")
        .map(([key, entry]) => [
          key,
          key === "section"
            ? (c.sections.find((section) => section.id === entry)?.title ??
              (entry ? "Former section" : "Unsectioned"))
            : entry,
        ]),
    );
  };
  s.history.push({
    id: uid(),
    parent: c.id,
    target,
    title,
    action,
    at: new Date().toISOString(),
    before: copy(historicalValue(before)),
    after: copy(historicalValue(after)),
  });
}
export function initialState(empty = false): DemoState {
  const state: DemoState = { collections: [], history: [], erasedIds: [] };
  if (empty) return state;
  const shopping = baseCollection("shopping", "Groceries");
  shopping.notes = "For the weekend. Oat milk for breakfast.";
  const produce = { id: uid(), title: "Produce" };
  const dairy = { id: uid(), title: "Dairy" };
  shopping.sections = [produce, dairy];
  shopping.items = [
    baseItem("Apples", produce.id, "For lunchboxes", "6"),
    baseItem("Carrots", produce.id, "", "1 bag"),
    baseItem("Milk", dairy.id, "Oat milk", "2 cartons"),
    baseItem("Yogurt", dairy.id, "", "1 tub"),
    baseItem("Batteries", "", "AA", "1 pack"),
  ];
  shopping.items[1]!.completed = true;
  shopping.items[3]!.completed = true;
  const hardware = baseCollection("shopping", "Hardware");
  hardware.items = [baseItem("Picture hooks", "", "", "1 pack")];
  const packing = baseCollection("template", "Camping packing");
  packing.notes = "Check the weather before leaving.";
  const clothes = { id: uid(), title: "Clothing" };
  const gear = { id: uid(), title: "Equipment" };
  packing.sections = [clothes, gear];
  packing.items = [
    baseItem("Rain jacket", clothes.id),
    baseItem("Warm socks", clothes.id),
    baseItem("Tent", gear.id, "Check the poles"),
    baseItem("Headlamp", gear.id, "Charge beforehand"),
  ];
  const recipe = baseCollection("template", "Pasta dinner");
  recipe.notes =
    "Our usual dinner for four. Keep the pasta water for the sauce.";
  const ingredients = { id: uid(), title: "Ingredients" };
  const preparation = { id: uid(), title: "Preparation" };
  recipe.sections = [ingredients, preparation];
  recipe.items = [
    baseItem("Pasta — 400 g", ingredients.id, "Use the large pot."),
    baseItem("Tomatoes — 1 tin", ingredients.id),
    baseItem("Boil the water", preparation.id, "Salt before adding pasta."),
    baseItem("Simmer the sauce", preparation.id, "Stir occasionally."),
  ];
  const run = baseCollection("run", "Pasta dinner — practice run");
  run.sourceId = recipe.id;
  run.sourceTitle = recipe.title;
  run.notes = recipe.notes;
  const sectionIds = new Map(
    recipe.sections.map((section) => [section.id, uid()]),
  );
  run.sections = recipe.sections.map((section) => ({
    ...section,
    id: sectionIds.get(section.id)!,
  }));
  run.items = recipe.items.map((item) => ({
    ...item,
    id: uid(),
    section: sectionIds.get(item.section) ?? "",
  }));
  run.items[0]!.completed = true;
  run.items[1]!.completed = true;
  const task = baseCollection("task", "Water the plants");
  task.notes = "Before leaving for the weekend.";
  const done = baseCollection("task", "Return library books");
  done.completed = true;
  const archived = baseCollection("shopping", "Holiday supplies");
  archived.archived = true;
  archived.items = [baseItem("Wrapping paper", "", "", "2 rolls")];
  const trashed = baseCollection("shopping", "Old grocery list");
  trashed.trashed = true;
  trashed.items = [baseItem("Bread"), { ...baseItem("Jam"), trashed: true }];
  state.collections = [
    task,
    done,
    shopping,
    hardware,
    packing,
    recipe,
    run,
    archived,
    trashed,
  ];
  state.collections.forEach((collection, index) => {
    collection.created += index;
    change(
      state,
      collection,
      collection.id,
      collection.title,
      collection.kind === "task"
        ? "Existing task at MVP 2 migration"
        : "Synthetic example created",
      null,
      collectionValues(collection),
    );
    for (const section of collection.sections)
      change(
        state,
        collection,
        section.id,
        section.title,
        "Section created",
        null,
        section,
      );
    for (const item of collection.items)
      change(
        state,
        collection,
        item.id,
        item.title,
        "Item created",
        null,
        item,
      );
  });
  return state;
}
