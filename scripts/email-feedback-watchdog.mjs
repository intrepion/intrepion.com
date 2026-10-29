import { execFile } from "node:child_process";
import { promisify } from "node:util";

// AWS credentials come from the operations environment, not application keys.
const queue = process.env.FEEDBACK_DLQ_URL;
if (
  !queue ||
  !/^https:\/\/sqs\.us-west-2\.amazonaws\.com\/\d{12}\/intrepion-invitation-feedback-dead-letter$/.test(
    queue,
  )
)
  throw new Error("Feedback queue configuration is missing or invalid.");
const { stdout } = await promisify(execFile)(
  "aws",
  [
    "sqs",
    "get-queue-attributes",
    "--queue-url",
    queue,
    "--attribute-names",
    "ApproximateNumberOfMessages",
    "ApproximateNumberOfMessagesNotVisible",
    "ApproximateNumberOfMessagesDelayed",
    "--region",
    "us-west-2",
    "--output",
    "json",
  ],
  { timeout: 30000, maxBuffer: 16384 },
);
const attributes = JSON.parse(stdout).Attributes;
const names = [
  "ApproximateNumberOfMessages",
  "ApproximateNumberOfMessagesNotVisible",
  "ApproximateNumberOfMessagesDelayed",
];
const counts = names.map((name) => {
  const value = attributes?.[name];
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw new Error("Feedback queue monitoring returned incomplete data.");
  return Number(value);
});
if (counts.some((count) => !Number.isSafeInteger(count) || count > 0))
  throw new Error(
    "Feedback delivery needs review: the dead-letter queue is not empty.",
  );
console.log("Feedback dead-letter queue is empty.");
