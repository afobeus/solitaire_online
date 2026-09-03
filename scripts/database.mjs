import { backup, DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
const [mode, input] = process.argv.slice(2),
  database = resolve(process.env.DATABASE_PATH ?? "./data/solitaire.sqlite");
function stamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}
async function safeBackup(target) {
  mkdirSync(dirname(target), { recursive: true });
  const source = new DatabaseSync(database);
  try {
    source.exec("PRAGMA wal_checkpoint(PASSIVE)");
    await backup(source, target);
  } finally {
    source.close();
  }
  const check = new DatabaseSync(target, { readOnly: true });
  try {
    const row = check.prepare("PRAGMA integrity_check").get();
    if (row.integrity_check !== "ok")
      throw new Error("Проверка резервной копии не пройдена.");
  } finally {
    check.close();
  }
}
if (mode === "backup") {
  const target = resolve(input ?? `./backups/solitaire-${stamp()}.sqlite`);
  await safeBackup(target);
  console.log(target);
} else if (mode === "restore") {
  if (process.env.RESTORE_OFFLINE !== "1")
    throw new Error(
      "Сначала остановите приложение. Для production используйте scripts/restore.sh; локально после остановки задайте RESTORE_OFFLINE=1.",
    );
  if (!input)
    throw new Error(
      "Укажите файл: node scripts/database.mjs restore /backups/имя.sqlite",
    );
  const source = resolve(input),
    check = new DatabaseSync(source, { readOnly: true });
  try {
    const row = check.prepare("PRAGMA integrity_check").get();
    if (row.integrity_check !== "ok") throw new Error("Файл повреждён.");
    check
      .prepare(
        "SELECT id,username,password_hash,salt,games,wins,duel_wins FROM users LIMIT 0",
      )
      .all();
    check
      .prepare("SELECT match_id,user_id,duel_wins,reason FROM results LIMIT 0")
      .all();
  } finally {
    check.close();
  }
  const current = `${database}.before-restore-${stamp()}`;
  await safeBackup(current);
  const temporary = `${database}.restoring`;
  copyFileSync(source, temporary);
  rmSync(`${database}-wal`, { force: true });
  rmSync(`${database}-shm`, { force: true });
  renameSync(temporary, database);
  console.log(`Восстановлено. Предыдущее состояние: ${current}`);
} else throw new Error("Используйте backup [файл] или restore <файл>.");
