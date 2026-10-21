import { strict as assert } from "node:assert";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { TaskSchema } from "../src/gen/life/v1/tasks_pb.js";
import { ordered, validate } from "../src/lib/model.js";
test("field validation counts code points rather than UTF-16 units", () => {
  assert.equal(
    validate({ title: "🦀".repeat(200), notes: "" }).title,
    undefined,
  );
  assert.equal(
    validate({ title: "🦀".repeat(201), notes: "" }).title,
    "Use 200 characters or fewer.",
  );
  assert.equal(validate({ title: " \n ", notes: "" }).title, "Enter a title.");
  assert.equal(
    validate({ title: "Title", notes: "x".repeat(10001) }).notes,
    "Use 10,000 characters or fewer.",
  );
});
test("completion changes grouping without changing immutable creation order", () => {
  const old = create(TaskSchema, { id: "old", createdOrder: 1n });
  const recent = create(TaskSchema, { id: "recent", createdOrder: 3n });
  const done = create(TaskSchema, {
    id: "done",
    createdOrder: 4n,
    completed: true,
  });
  const input = [old, done, recent];
  assert.deepEqual(
    ordered(input).map((t) => t.id),
    ["recent", "old", "done"],
  );
  assert.deepEqual(
    input.map((t) => t.id),
    ["old", "done", "recent"],
  );
});
