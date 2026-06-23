import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.ARBOR_DB_PATH ?? join(process.cwd(), "arbor.sqlite");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function addColumnIfMissing(table: string, columnDef: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch {
    // column already exists
  }
}

export function migrate(): void {
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);

  // Columns added to existing tables after their initial release. These are
  // tolerated as no-ops once the column is present (fresh DBs get them from
  // schema.sql).
  addColumnIfMissing("runs", "session_id TEXT");
  addColumnIfMissing("projects", "harness_profile_id TEXT REFERENCES harness_profiles(id)");

  // Data migrations. Each is idempotent so it is safe to re-run on every boot.
  const harnessProfiles = readFileSync(
    join(__dirname, "migrations", "004_harness_profiles.sql"),
    "utf8"
  );
  db.exec(harnessProfiles);
}

export function getSetting(key: string): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}
