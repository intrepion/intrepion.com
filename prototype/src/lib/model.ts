export interface Task {
  id: string;
  title: string;
  notes: string;
  completed: boolean;
  createdOrder: number;
}

export interface Draft {
  id: string;
  title: string;
  notes: string;
}

export type FieldErrors = Partial<Record<"title" | "notes", string>>;

export function seedTasks(): Task[] {
  return [
    { id: "sample-weekend", title: "Plan the weekend", notes: "Look up a nearby walking route.", completed: false, createdOrder: 3 },
    { id: "sample-plants", title: "Water the plants", notes: "", completed: false, createdOrder: 2 },
    { id: "sample-library", title: "Return library books", notes: "", completed: true, createdOrder: 1 },
  ];
}

// Count Unicode code points, consistently with the experimental Rust validation.
export const characterCount = (value: string): number => Array.from(value).length;

export function validateDraft(draft: Draft): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.title.trim()) errors.title = "Enter a title.";
  else if (characterCount(draft.title) > 200) errors.title = "Use 200 characters or fewer.";
  if (characterCount(draft.notes) > 10_000) errors.notes = "Use 10,000 characters or fewer.";
  return errors;
}

export function orderedTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => Number(a.completed) - Number(b.completed) || b.createdOrder - a.createdOrder);
}

export function saveDraft(tasks: Task[], draft: Draft): Task[] {
  if (Object.keys(validateDraft(draft)).length) throw new Error("invalid draft");
  const existing = tasks.find(task => task.id === draft.id);
  if (existing) {
    return tasks.map(task => task.id === draft.id ? { ...task, title: draft.title, notes: draft.notes } : task);
  }
  return [...tasks, {
    ...draft,
    completed: false,
    createdOrder: Math.max(0, ...tasks.map(task => task.createdOrder)) + 1,
  }];
}
