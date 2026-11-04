// The exchange lab (PARITY_EXCHANGE=1 in fixture-server.mjs), for the iPad
// bot-to-bot exchange UI test (ios/UITests/DesktopExchangeUITests.swift).
// Off by default: nothing of the reference dataset changes without it.
//
// Pass one opens a conversation on Helios; between the passes bots.json
// marks it opened by Ara (a "pair" conversation, server/peers/
// inter-bot-conversations.ts) and the transcript gets a few lines, user
// lines from Ara and bot lines from Helios, so Ara's chat shows the quiet
// exchange line and its page.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const EXCHANGE_LAB = process.env.PARITY_EXCHANGE === "1";
export const EXCHANGE_LAB_LINES = [
  ["user", "Peux-tu vérifier les sauvegardes de la nuit ?"],
  ["bot", "Les trois sauvegardes de la nuit sont complètes."],
  ["user", "Merci, et l'espace disque ?"],
  ["bot", "Il reste 42 % sur le volume principal."],
];

const lab = { threadId: null, helios: null, ara: null };

export async function seedExchangeLab(base, api, ids) {
  const created = await api(base, "POST", `/api/bots/${ids.helios.id}/tasks`, { title: "Ara et Helios" });
  lab.threadId = created.task?.threadId ?? null;
  lab.helios = ids.helios.id;
  lab.ara = ids.ara.id;
  // back on Helios's first conversation, as the reference has it
  await api(base, "POST", `/api/bots/${ids.helios.id}/tasks/${ids.helios.threadId}?messages=0`);
}

export function seedExchangeLabStore(dataDir) {
  if (!lab.threadId) return;
  const file = join(dataDir, "bots.json");
  const bots = JSON.parse(readFileSync(file, "utf8"));
  const at = Date.now() - 30 * 60_000;
  for (const bot of bots) {
    if (bot.id !== lab.helios) continue;
    for (const task of bot.tasks ?? []) {
      if (task.threadId === lab.threadId) task.openedBy = { botId: lab.ara, name: "Ara", kind: "pair", at };
    }
  }
  writeFileSync(file, JSON.stringify(bots, null, 2));
  const db = new DatabaseSync(join(dataDir, "messages.db"));
  const insert = db.prepare("INSERT OR REPLACE INTO messages (thread_id, id, at, role, kind, text, json) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const leaf = db.prepare("INSERT OR REPLACE INTO thread_state (thread_id, active_leaf_id) VALUES (?, ?)");
  db.prepare("DELETE FROM messages WHERE thread_id = ?").run(lab.threadId);
  let parentId;
  EXCHANGE_LAB_LINES.forEach(([role, text], i) => {
    const record = {
      id: `exchange-lab-${i}`, at: at + i * 60_000, role, kind: "text", text,
      ...(parentId ? { parentId } : {}),
      ...(role === "bot" ? { turnId: `turn-exchange-lab-${i}`, turnTerminal: true, turnSucceeded: true } : {}),
    };
    insert.run(lab.threadId, record.id, record.at, record.role, "text", record.text, JSON.stringify(record));
    parentId = record.id;
  });
  leaf.run(lab.threadId, parentId);
  db.close();
}
