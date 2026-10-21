import type { Task } from "../gen/life/v1/tasks_pb";
export type Fields = { title: string; notes: string };
export function validate(fields: Fields): { title?: string; notes?: string } {
  return {
    title: !fields.title.trim()
      ? "Enter a title."
      : [...fields.title].length > 200
        ? "Use 200 characters or fewer."
        : fields.title.includes("\0")
          ? "Remove the null character."
          : undefined,
    notes:
      [...fields.notes].length > 10000
        ? "Use 10,000 characters or fewer."
        : fields.notes.includes("\0")
          ? "Remove the null character."
          : undefined,
  };
}
export function ordered(tasks: readonly Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      Number(a.completed) - Number(b.completed) ||
      (a.createdOrder > b.createdOrder
        ? -1
        : a.createdOrder < b.createdOrder
          ? 1
          : 0),
  );
}
