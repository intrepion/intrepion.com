import { writeFile } from "node:fs/promises";
const database = process.env.D1_DATABASE_ID;
if (!database || !/^[a-zA-Z0-9-]+$/.test(database))
  throw new Error("Set D1_DATABASE_ID.");
await writeFile(
  "server/wrangler.production.json",
  JSON.stringify({
    name: "intrepion-database-admin",
    compatibility_date: "2026-10-20",
    d1_databases: [
      {
        binding: "DB",
        database_name: "intrepion",
        database_id: database,
        migrations_dir: "migrations",
      },
    ],
  }),
);
