// The interactive cards' lab (PARITY_CARDS=1 in fixture-server.mjs), for the
// WP2 UI tests (ios/UITests/CardsUITests.swift). Off by default: nothing of
// the reference dataset changes without it.
//
// Every card comes from the server's own mechanisms:
//
// - Approvals are real permission asks. A second engine instance ("asks")
//   runs the repository's fake Claude CLI in `hang` mode with a dump file;
//   once a turn runs, the lab connects to the permission broker socket the
//   CLI was given (its --mcp-config, exactly as server/command-allowlist
//   .e2e.test.ts does) and asks, so the cards, the answers the engine
//   receives and the saved command rules are the real ones.
// - A parallel task is a real send with busyMode "parallel" while that turn
//   runs.
// - Credential, option, access, owner-wait, goal-run and error rows are
//   written into the transcript store between the two passes, the way the
//   fixture seeds every other transcript, and are then served, patched and
//   resumed by the server's real routes.
//
// Hooks, on the fixture's front (the computer double):
//   GET  /__parity/cards              -> lab ids, engine answers
//   POST /__parity/cards/asks         {asks:[{tool,input}]} -> {requestIds}
//   POST /__parity/cards/parallel     {title} -> {threadId}
//
// For the composer tests (WP3) the holding engine also lists a lab slash
// command (FAKE_CLAUDE_COMMANDS) and records every prompt it is sent
// (FAKE_CLAUDE_PROMPTS, served as `prompts`), and a room ("Lab Room") is led
// by Room Lab on the same engine, so a room turn holds still too.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const CARD_LAB = process.env.PARITY_CARDS === "1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const lab = {
  bots: {},
  room: null,
  dumpPath: "",
  promptsPath: "",
  socketPath: null,
  sockets: [],
  answers: {},
  asks: [],
};

// The managed connected-apps broker has been removed. These exports stay as
// no-ops so the fixture server keeps loading without starting a broker.
export function startCardLabBroker() {
  return Promise.resolve(null);
}

export function cardLabServerEnv() {
  return {};
}

/** The engine instance whose turns hold still while the lab asks. */
export function cardLabInstances(root, dataDir) {
  lab.dumpPath = join(dataDir, "card-lab-dump.json");
  lab.promptsPath = join(dataDir, "card-lab-prompts.jsonl");
  const commandsPath = join(dataDir, "card-lab-commands.json");
  writeFileSync(commandsPath, JSON.stringify([
    { name: "compact", description: "Compact", argumentHint: "" },
    { name: "parity-check", description: "Laboratoire : une commande de remplacement", argumentHint: "[note]" },
  ]));
  return {
    asks: {
      driver: "claudeAgent",
      displayName: "Card lab engine",
      environment: {
        FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_DUMP: lab.dumpPath,
        FAKE_CLAUDE_PROMPTS: lab.promptsPath, FAKE_CLAUDE_COMMANDS: commandsPath,
      },
      config: { cli: join(root, "server", "testing", "fake-claude-cli.ts") },
    },
  };
}

// ── pass one: the bots ──────────────────────────────────────────────────
const LAB_BOTS = [
  // approvals and the parallel task: the holding engine
  { key: "asks", name: "Card Lab", instance: "asks" },
  // connector and credential cards: the ordinary fixture engine resumes
  { key: "connect", name: "Connect Lab", instance: "claude" },
  // a first-run quiz, an access card, an owner wait, a goal run
  { key: "quiz", name: "Quiz Lab", instance: "claude" },
  // a failed turn as the last row
  { key: "retry", name: "Retry Lab", instance: "claude" },
  // Lab Room's lead: the holding engine, apart from Card Lab's own turns
  { key: "room", name: "Room Lab", instance: "asks" },
];

export async function seedCardLabBots(base, api) {
  for (const spec of LAB_BOTS) {
    const { bot } = await api(base, "POST", "/api/bots", {
      name: spec.name,
      title: "Laboratoire de cartes",
      modelSelection: { instanceId: spec.instance, model: "claude-sonnet-5" },
    });
    await api(base, "PATCH", `/api/bots/${bot.id}`, { color: "teal" });
    // Asks reach the person: never auto-reviewed on this thread.
    await api(base, "PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, { approvalMode: "ask" }).catch(() => {});
    lab.bots[spec.key] = { id: bot.id, threadId: bot.threadId, name: spec.name };
  }
  // A room led by Room Lab: its turns hold still, for Steer and Interrupt.
  const created = await api(base, "POST", "/api/groups", { name: "Lab Room", memberIds: [lab.bots.room.id] });
  const room = created.group ?? created.room ?? created;
  await api(base, "PATCH", `/api/groups/${room.id}`, { defaultResponder: { kind: "member", botId: lab.bots.room.id } })
    .catch((error) => console.error(`[parity] lab room responder: ${error.message}`));
  lab.room = { id: room.id, threadId: room.threadId, name: "Lab Room" };
  return lab.bots;
}

// ── between passes: the transcripts ─────────────────────────────────────
export function seedCardLabTranscripts(dataDir) {
  const db = new DatabaseSync(join(dataDir, "messages.db"));
  const insert = db.prepare(
    "INSERT OR REPLACE INTO messages (thread_id, id, at, role, kind, text, json) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const leaf = db.prepare("INSERT OR REPLACE INTO thread_state (thread_id, active_leaf_id) VALUES (?, ?)");
  const clear = db.prepare("DELETE FROM messages WHERE thread_id = ?");
  const now = Date.now();
  const write = (threadId, records) => {
    clear.run(threadId);
    let parent;
    records.forEach((fields, index) => {
      const record = { at: now - (records.length - index) * 60_000, ...fields, ...(parent ? { parentId: parent } : {}) };
      insert.run(threadId, record.id, record.at, record.role, record.kind, record.text ?? "", JSON.stringify(record));
      parent = record.id;
    });
    leaf.run(threadId, parent);
  };

  write(lab.bots.asks.threadId, [
    { id: "lab-asks-1", role: "user", kind: "text", text: "Prépare le rapport de remplacement." },
    { id: "lab-asks-2", role: "bot", kind: "text", text: "Je commence. Je te demanderai avant d'agir.", turnId: "lab-turn-1", turnTerminal: true, turnSucceeded: true },
  ]);
  write(lab.bots.connect.threadId, [
    { id: "lab-connect-1", role: "user", kind: "text", text: "Relie mes outils de remplacement." },
    { id: "lab-connector-gmail", role: "bot", kind: "connector", text: "Connecter Gmail",
      connector: { slug: "gmail", label: "Gmail", description: "Lire et classer les courriels de remplacement.", status: "required", resumeKey: "lab-gmail" } },
    { id: "lab-connector-slack", role: "bot", kind: "connector", text: "Connecter Slack",
      connector: { slug: "slack", label: "Slack", description: "Publier un résumé de remplacement.", status: "required", resumeKey: "lab-slack" } },
    { id: "lab-secret-waiting", role: "bot", kind: "secret", text: "Clé requise",
      secret: { target: "openai", label: "Clé de remplacement", description: "Une clé factice pour le laboratoire.", placeholder: "sk-…", helpUrl: "https://example.com/keys", requestKey: "lab-key-1" } },
    { id: "lab-secret-failed", role: "bot", kind: "secret", text: "Jeton requis",
      secret: { target: "openai", label: "Jeton de remplacement", description: "Un jeton factice.", requestKey: "lab-key-2", dismissed: true, resumed: false, error: "La reprise a échoué : l'ordinateur était occupé." } },
  ]);
  write(lab.bots.quiz.threadId, [
    { id: "lab-quiz-1", role: "user", kind: "text", text: "Montre-moi les cartes de remplacement." },
    { id: "lab-access", role: "bot", kind: "access", text: "Aucun accès pour ce tour.",
      access: { reason: "no_access", engine: "Claude", botId: lab.bots.quiz.id, ownerPrincipalId: "principal-owner", payer: "speaker", cause: "no_credentials" } },
    { id: "lab-owner-wait", role: "bot", kind: "options", text: "", state: "waiting-on-owner", ownerName: "Liora" },
    { id: "lab-goal", role: "bot", kind: "goal.run", text: "Objectif terminé",
      goalRun: { runId: "lab-goal-run", goal: "Préparer le plan de remplacement du trimestre", status: "completed", coordinatorBotId: lab.bots.quiz.id, coordinatorName: "Quiz Lab", turnCount: 3, maxTurns: 6, detail: "Trois étapes de remplacement terminées.", startedAt: now - 3_600_000, finishedAt: now - 600_000 } },
    { id: "lab-quiz-card", role: "bot", kind: "options", text: "Par où commencer ?",
      card: { title: "Par où commencer ?", subtitle: "Choisis une piste de remplacement.", options: ["Les courriels", "Le calendrier"] } },
  ]);
  write(lab.bots.retry.threadId, [
    { id: "lab-retry-1", role: "user", kind: "text", text: "Résume la semaine de remplacement." },
    { id: "lab-retry-error", role: "bot", kind: "activity", text: "",
      tool: { name: "error: Le moteur s'est arrêté avant de répondre.", ok: false } },
  ]);
  db.close();
}

// ── live: asks and parallel tasks ───────────────────────────────────────
async function busy(base, api) {
  const bot = (await api(base, "GET", "/api/bots")).bots.find((candidate) => candidate.id === lab.bots.asks.id);
  return Boolean(bot?.busy);
}

/** A running turn on Card Lab and the broker socket its CLI was given. */
async function ensureTurn(base, api) {
  if (lab.socketPath && await busy(base, api)) return;
  rmSync(lab.dumpPath, { force: true });
  lab.socketPath = null;
  await api(base, "POST", `/api/bots/${lab.bots.asks.id}/messages`, {
    threadId: lab.bots.asks.threadId,
    text: `Tâche de laboratoire ${randomUUID().slice(0, 6)} : attends mes approbations.`,
  });
  for (let i = 0; i < 150 && !existsSync(lab.dumpPath); i++) await sleep(100);
  const dump = JSON.parse(readFileSync(lab.dumpPath, "utf8"));
  lab.socketPath = dump.mcpConfig.mcpServers.ogb.args.at(-1);
}

async function ask(tool, input) {
  const socket = connect(lab.socketPath);
  lab.sockets.push(socket);
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  const id = randomUUID();
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    const line = buffer.split("\n")[0];
    if (buffer.includes("\n") && !lab.answers[id]) {
      try { lab.answers[id] = JSON.parse(line); } catch { /* partial */ }
    }
  });
  socket.on("error", () => {});
  socket.write(`${JSON.stringify({ t: "ask", id, tool, input })}\n`);
  lab.asks.push({ id, tool });
  return id;
}

async function waitForCards(base, api, ids) {
  for (let i = 0; i < 150; i++) {
    const page = await api(base, "GET", `/api/threads/${lab.bots.asks.threadId}/messages?limit=200`);
    const seen = new Set(page.messages.map((message) => message.card?.requestId).filter(Boolean));
    if (ids.every((id) => seen.has(id))) return;
    await sleep(100);
  }
  throw new Error("the asks never reached the transcript");
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

/** Handles /__parity/cards*; false for anything else. */
export async function cardLabHook(req, res, url, base, api) {
  if (!url.pathname.startsWith("/__parity/cards")) return false;
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (!CARD_LAB) return send(404, { error: "start the fixture with PARITY_CARDS=1" }), true;
  try {
    if (req.method === "GET" && url.pathname === "/__parity/cards") {
      const prompts = existsSync(lab.promptsPath)
        ? readFileSync(lab.promptsPath, "utf8").split("\n").filter(Boolean)
        : [];
      send(200, { bots: lab.bots, room: lab.room, answers: lab.answers, asks: lab.asks, prompts });
    } else if (req.method === "POST" && url.pathname === "/__parity/cards/asks") {
      const body = await readJson(req);
      await ensureTurn(base, api);
      const requestIds = [];
      for (const each of body.asks ?? []) requestIds.push(await ask(each.tool, each.input ?? {}));
      await waitForCards(base, api, requestIds);
      send(200, { requestIds, threadId: lab.bots.asks.threadId });
    } else if (req.method === "POST" && url.pathname === "/__parity/cards/parallel") {
      const body = await readJson(req);
      await ensureTurn(base, api);
      const title = body.title ?? "Inventaire de remplacement";
      await api(base, "POST", `/api/bots/${lab.bots.asks.id}/messages`, {
        threadId: lab.bots.asks.threadId, text: title, busyMode: "parallel",
      });
      let threadId = null;
      for (let i = 0; i < 150 && !threadId; i++) {
        const bot = (await api(base, "GET", "/api/bots")).bots.find((candidate) => candidate.id === lab.bots.asks.id);
        threadId = (bot?.tasks ?? []).find((task) => task.parallelOf?.threadId === lab.bots.asks.threadId && task.parallelOf.reportedAt === undefined)?.threadId ?? null;
        if (!threadId) await sleep(100);
      }
      if (!threadId) throw new Error("no parallel task opened");
      send(200, { threadId });
    } else {
      send(404, { error: "no such card lab hook" });
    }
  } catch (error) {
    send(500, { error: String(error?.message ?? error) });
  }
  return true;
}

export function closeCardLab() {
  for (const socket of lab.sockets) socket.destroy();
}
