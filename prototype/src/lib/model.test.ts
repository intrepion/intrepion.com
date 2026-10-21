import assert from "node:assert/strict";
import test from "node:test";
import { orderedTasks, saveDraft, seedTasks, validateDraft } from "./model.ts";

test("completion and edits preserve creation order without mutating the input", () => {
  const original = seedTasks();
  const completed = original.map(task => task.id === "sample-weekend" ? { ...task, completed: true } : task);
  const edited = saveDraft(completed, { id: "sample-library", title: "Edited title", notes: "" });
  assert.deepEqual(orderedTasks(edited).map(task => task.id), ["sample-plants", "sample-weekend", "sample-library"]);
  assert.equal(edited.find(task => task.id === "sample-library")?.completed, true);
  assert.equal(original.find(task => task.id === "sample-library")?.title, "Return library books");
});

test("a retried creation after a lost response does not duplicate its task", () => {
  const draft = { id: "one-request-id", title: "Retry me", notes: "" };
  const saved = saveDraft(seedTasks(), draft);
  const retried = saveDraft(saved, draft);
  assert.equal(retried.filter(task => task.id === draft.id).length, 1);
  assert.equal(retried.find(task => task.id === draft.id)?.createdOrder, 4);
});

test("validation counts Unicode code points and rejects blank or oversized fields", () => {
  assert.deepEqual(validateDraft({ id: "a", title: "🦀".repeat(200), notes: "" }), {});
  assert.ok(validateDraft({ id: "a", title: "🦀".repeat(201), notes: "" }).title);
  assert.ok(validateDraft({ id: "a", title: " \n\t ", notes: "" }).title);
  assert.ok(validateDraft({ id: "a", title: "Valid", notes: "x".repeat(10_001) }).notes);
});
