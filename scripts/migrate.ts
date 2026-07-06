import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool } from "../src/db.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

async function migrate() {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); 

  if (files.length === 0) {
    console.log("No migrations found.");
    return;
  }

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    console.log(`Applying ${file} …`);
    await pool.query(sql);
  }

  console.log(`Done. Applied ${files.length} migration(s).`);
}

migrate()
  .catch((err) => {
    console.error("Migration failed:", err);
    
  })
  .finally(() => pool.end());
