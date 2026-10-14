import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import type { Settings, Task } from "../shared/types.js";

export const dataDir = path.resolve(process.env.DATA_DIR || "./data");
mkdirSync(path.join(dataDir, "images"), { recursive: true });
const keyPath = path.join(dataDir, "master.key");
if (!process.env.ENCRYPTION_KEY && !existsSync(keyPath))
  writeFileSync(keyPath, randomBytes(32).toString("hex"), { mode: 0o600 });
const key = Buffer.from(
  process.env.ENCRYPTION_KEY || readFileSync(keyPath, "utf8").trim(),
  "hex",
);
if (key.length !== 32)
  throw new Error("ENCRYPTION_KEY must be 64 hexadecimal characters");
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), encrypted]
    .map((b) => b.toString("base64"))
    .join(".");
}
export function decrypt(value: string) {
  const [iv, tag, data] = value.split(".").map((v) => Buffer.from(v, "base64"));
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}
export const db = new DatabaseSync(path.join(dataDir, "frame.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS settings (user_id TEXT PRIMARY KEY REFERENCES users(id), data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS secrets (user_id TEXT NOT NULL, provider_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(user_id,provider_id));
  CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS tasks_owner ON tasks(user_id);
  CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, mime TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS admin (singleton INTEGER PRIMARY KEY CHECK(singleton=1), user_id TEXT UNIQUE NOT NULL REFERENCES users(id), username TEXT UNIQUE NOT NULL);
`);
if (
  !(db.prepare("PRAGMA table_info(assets)").all() as { name: string }[]).some(
    (c) => c.name === "task_id",
  )
)
  db.exec("ALTER TABLE assets ADD COLUMN task_id TEXT");
db.exec("CREATE INDEX IF NOT EXISTS assets_task ON assets(user_id, task_id)");
// Preserve old task favorites as individual image favorites, and associate legacy assets.
for (const row of db.prepare("SELECT id,user_id,data FROM tasks").all() as {
  id: string;
  user_id: string;
  data: string;
}[]) {
  const task = JSON.parse(row.data);
  const images: string[] = task.results.flatMap(
    (r: { images: string[] }) => r.images,
  );
  if (!Array.isArray(task.favoriteImages))
    task.favoriteImages = task.favorite ? [...new Set(images)] : [];
  delete task.favorite;
  db.prepare("UPDATE tasks SET data=? WHERE id=?").run(
    JSON.stringify(task),
    row.id,
  );
  for (const image of images) {
    const id = image.startsWith("/api/images/")
      ? image.slice("/api/images/".length)
      : "";
    if (id)
      db.prepare(
        "UPDATE assets SET task_id=? WHERE id=? AND user_id=? AND task_id IS NULL",
      ).run(row.id, id, row.user_id);
  }
}
// Preserve the first legacy account and its data, but only this account can log in.
// The legacy users.email column remains solely for database compatibility.
if (!db.prepare("SELECT 1 FROM admin").get()) {
  const legacy = db
    .prepare("SELECT id FROM users ORDER BY rowid LIMIT 1")
    .get() as { id: string } | undefined;
  if (legacy) {
    db.prepare("INSERT INTO admin VALUES (1,?,?)").run(legacy.id, "admin");
    db.prepare("DELETE FROM sessions").run();
  }
}
export function getSettings(userId: string): Settings {
  const row = db
    .prepare("SELECT data FROM settings WHERE user_id=?")
    .get(userId) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : { providers: [], textModel: null };
}
export function saveSettings(userId: string, settings: Settings) {
  db.prepare(
    "INSERT INTO settings VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data",
  ).run(userId, JSON.stringify(settings));
}
export function getTask(userId: string, id: string): Task | undefined {
  const row = db
    .prepare("SELECT data FROM tasks WHERE id=? AND user_id=?")
    .get(id, userId) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : undefined;
}
export function saveTask(userId: string, task: Task) {
  db.prepare(
    "INSERT INTO tasks VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE tasks.user_id=excluded.user_id",
  ).run(task.id, userId, JSON.stringify(task));
}
export function getSecret(userId: string, providerId: string) {
  const row = db
    .prepare("SELECT value FROM secrets WHERE user_id=? AND provider_id=?")
    .get(userId, providerId) as { value: string } | undefined;
  if (!row) throw new Error("接入商尚未配置 API Key");
  return decrypt(row.value);
}
