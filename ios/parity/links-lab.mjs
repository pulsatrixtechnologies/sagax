// The links lab (PARITY_LINKS=1 in fixture-server.mjs), for the Go to
// message test of the bot panel's Links (ios/UITests/ProfileUITests.swift).
// Off by default: nothing of the reference dataset changes without it.
//
// Pass one gives Ara a second conversation through the API, then selects
// her first one again, so her chat opens where the reference has it. Between
// the passes that second conversation gets one reply carrying a link, the
// newest of all her links: Go to message on it must switch the chat on
// screen to that conversation, never open a second chat over it.
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const LINKS_LAB = process.env.PARITY_LINKS === "1";
export const LINKS_LAB_URL = "https://links-lab.example.com/autre-conversation";
export const LINKS_LAB_TEXT = "Le lien de l'autre conversation est prêt.";

const lab = { threadId: null };

export async function seedLinksLab(base, api, ids) {
  const created = await api(base, "POST", `/api/bots/${ids.ara.id}/tasks`, { title: "Autre conversation" });
  lab.threadId = created.task?.threadId ?? created.bot.threadId;
  await api(base, "POST", `/api/bots/${ids.ara.id}/tasks/${ids.ara.threadId}?messages=0`);
}

export function seedLinksLabTranscript(dataDir) {
  if (!lab.threadId) return;
  const db = new DatabaseSync(join(dataDir, "messages.db"));
  const insert = db.prepare(
    "INSERT OR REPLACE INTO messages (thread_id, id, at, role, kind, text, json) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const leaf = db.prepare("INSERT OR REPLACE INTO thread_state (thread_id, active_leaf_id) VALUES (?, ?)");
  db.prepare("DELETE FROM messages WHERE thread_id = ?").run(lab.threadId);
  const at = Date.now() - 60_000;
  const ask = { id: "links-lab-ask", at: at - 60_000, role: "user", kind: "text", text: "Envoie-moi le lien." };
  const reply = {
    id: "links-lab-reply", at, parentId: ask.id, role: "bot", kind: "text",
    text: `${LINKS_LAB_TEXT}\n\n[Autre conversation](${LINKS_LAB_URL})`,
    turnId: "turn-links-lab-reply", turnTerminal: true, turnSucceeded: true,
  };
  for (const record of [ask, reply]) {
    insert.run(lab.threadId, record.id, record.at, record.role, "text", record.text, JSON.stringify(record));
  }
  leaf.run(lab.threadId, reply.id);
  db.close();
}
