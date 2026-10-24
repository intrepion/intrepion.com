// Local staging only. Never installs credentials on a provider or CI service.
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";

process.umask(0o077);
const path = ".env.setup.mvp3-credentials.json";
const names = ["PILOT_OPERATOR_TOKEN", "HOUSEHOLD_MAINTENANCE_TOKEN"];
let created = false;
try {
  const file = await open(path, "wx", 0o600);
  try {
    const credentials = Object.fromEntries(
      names.map((name) => [name, randomBytes(32).toString("hex")]),
    );
    await file.writeFile(JSON.stringify(credentials, null, 2) + "\n");
    await file.sync();
    created = true;
  } finally {
    await file.close();
  }
} catch (error) {
  if (error.code !== "EEXIST")
    throw new Error("Private staging file could not be created.", {
      cause: error,
    });
}
const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
try {
  const stat = await file.stat();
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600)
    throw new Error(
      "Private staging file must be a regular file with mode 0600.",
    );
  let credentials;
  try {
    credentials = JSON.parse(await file.readFile("utf8"));
  } catch {
    throw new Error(
      "Private staging file is invalid; it has not been replaced.",
    );
  }
  if (
    names.some((name) => !/^[a-f0-9]{64}$/.test(credentials?.[name] ?? "")) ||
    credentials[names[0]] === credentials[names[1]]
  )
    throw new Error(
      "Private staging credentials must be distinct 32-byte hex secrets.",
    );
  console.log(
    JSON.stringify({
      created,
      validated: true,
      mode: "0600",
      installed: false,
    }),
  );
} finally {
  await file.close();
}
