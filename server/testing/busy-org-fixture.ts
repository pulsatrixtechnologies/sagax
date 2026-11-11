// The data folder of a busy organization server (#3599), for the start
// tests and a profile of a start: 12 people, 40 bots in 12 sections, the
// organization's presets, 80 routines with 1,050 kept runs in a routines
// file near 6.6 MB, each run's conversation, and 20 conversations of 40 rows
// per bot (busy-org-threads.ts). One generator: the stored routine runs of the routine
// tests (routine-stored-runs.test.ts) come from storedRoutinesDocument too.
//
// Bots and sections go through the real server (seedBusyOrg), so they have
// the shape the server writes; the routines file and the presets are written
// directly, since a thousand runs cannot be made through the API in a test,
// and the conversations through the store and message database themselves.
//
// To profile a start on it: seed with seedBusyOrg, then org.start() with
// NODE_OPTIONS="--cpu-prof --cpu-prof-dir=<dir>" in the env object given to
// startOrgServer (it is read at every start).
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { FakeOidcUser } from "./fake-oidc-provider.ts";
import type { OrgServer } from "./org-server-harness.ts";

export const BUSY_ORG = { people: 12, bots: 40, sections: 12, routines: 80, runs: 1_050, presets: 12, topicsPerBot: 20, rowsPerTopic: 40 } as const;

export interface StoredRoutinesOptions {
  now: number;
  botIds: readonly string[];
  routines: number;
  /** Settled runs, one every 30 minutes back from `now`. */
  settled: number;
  prompt?: string;
  output?: string;
  extraRuns?: unknown[];
  routineRequestReceipts?: unknown[];
}

/** A routines.json document: `routines` daily routines, `settled` settled
 * runs spread over them (every seventh one failed), and three live runs
 * (running, queued, waiting on a person) on routines 1 to 3. */
export function storedRoutinesDocument(options: StoredRoutinesOptions): Record<string, unknown> {
  const { now, botIds, settled: count } = options;
  const prompt = options.prompt ?? "Report";
  const bot = (index: number) => botIds[index % botIds.length]!;
  const routines = Array.from({ length: options.routines }, (_, index) => ({
    id: `routine-${index}`, name: `Routine ${index}`, prompt, botId: bot(index),
    enabled: true, schedule: { type: "daily", time: "10:00" }, nextRunAt: now + 60 * 60_000,
    createdAt: now - 90 * 86_400_000, updatedAt: now - 90 * 86_400_000, timeoutMinutes: 30, postResults: true,
  }));
  const settled = Array.from({ length: count }, (_, index) => {
    const at = now - (count - index) * 30 * 60_000;
    const routine = index % options.routines;
    return {
      id: `old-${index}`, routineId: `routine-${routine}`, routineName: `Routine ${routine}`, botId: bot(routine),
      status: index % 7 === 0 ? "failed" : "completed", error: index % 7 === 0 ? "It did not answer" : undefined,
      scheduledFor: at, createdAt: at, startedAt: at, finishedAt: at + 60_000, threadId: `thread-old-${index}`,
      prompt, output: options.output ?? "Done.", timeoutMinutes: 30, attachments: [],
      readiness: [{ kind: "engine", ok: true, code: "ready", line: "Ready" }],
    };
  });
  const live = [
    { id: "live-running", routineId: "routine-1", routineName: "Routine 1", botId: bot(1), status: "running",
      scheduledFor: now - 60_000, createdAt: now - 60_000, startedAt: now - 60_000, threadId: "thread-live-running", prompt },
    { id: "live-queued", routineId: "routine-2", routineName: "Routine 2", botId: bot(2), status: "queued", manual: true,
      scheduledFor: now - 30_000, createdAt: now - 30_000, prompt },
    { id: "live-waiting", routineId: "routine-3", routineName: "Routine 3", botId: bot(3), status: "waiting",
      scheduledFor: now - 90_000, createdAt: now - 90_000, startedAt: now - 90_000, threadId: "thread-live-waiting", prompt,
      waitingSince: now - 80_000 },
  ];
  return {
    version: 1, frozenResultsCleared: true, postResultsMigrated: true, routines,
    runs: [...settled, ...live, ...(options.extraRuns ?? [])],
    routineRequestReceipts: options.routineRequestReceipts ?? [], webhookRunReceipts: [],
  };
}

/** The busy server's routines file: 80 routines, 1,050 settled runs whose
 * answers bring the file near 6.6 MB. */
export function busyOrgRoutinesDocument(now: number, botIds: readonly string[]): Record<string, unknown> {
  return storedRoutinesDocument({
    now, botIds, routines: BUSY_ORG.routines, settled: BUSY_ORG.runs,
    prompt: "Read the open queue and report what changed since the last run. ".repeat(4),
    output: "Checked the queue: every item is in order, one item to read again tomorrow. ".repeat(76),
  });
}

export function busyOrgPeople(): FakeOidcUser[] {
  return Array.from({ length: BUSY_ORG.people }, (_, index) => ({
    sub: `01JBUSYORGPERSON${String(index).padStart(10, "0")}`,
    email: `person${index}@example.test`,
    preferred_username: `person${index}`,
    name: `Person ${index}`,
    role: index === 0 ? "admin" : "employee",
  }));
}

/** The organization's presets, in the stored form of server/presets.ts. */
export function busyOrgPresetsDocument(now: number): Record<string, unknown> {
  const installId = "0".repeat(32);
  return {
    version: 1,
    presets: Array.from({ length: BUSY_ORG.presets }, (_, index) => ({
      id: `preset-${index}`, source: "org", installId, packageId: "team-roles", packageName: "Team roles", release: "1.0.0",
      publisherName: "Example organization", key: `role-${index}`, name: `Role ${index}`, description: `Starting point for role ${index}.`,
      bot: { name: `Role ${index}`, title: `Role ${index}`, soul: "Answer briefly and check the facts first. ".repeat(10) },
      addedAt: now - index * 86_400_000,
    })),
    content: { [installId]: { skills: [], playbooks: [] } },
  };
}

/** A call an earlier run left open in one conversation of the first bot. */
export interface BusyOrgCutRow { botId: string; threadId: string; messageId: string }

/**
 * Fill a started organization server (startOrgServer) with the busy data
 * and leave it stopped: the people sign in, make the bots in their sections,
 * then the routines file, the presets and the conversations are written.
 * Start it again with `org.start()`.
 */
export async function seedBusyOrg(org: OrgServer, now = Date.now()): Promise<{ people: FakeOidcUser[]; bots: Array<{ id: string; owner: number }>; cut: BusyOrgCutRow }> {
  const people = busyOrgPeople();
  await org.kill("SIGTERM");
  org.idp.directoryPeople = people.map((user) => org.idp.personOf(user));
  await org.start();
  const bots: Array<{ id: string; owner: number }> = [];
  for (let owner = 0; owner < people.length; owner += 1) {
    const auth = await org.signIn(people[owner]!);
    const count = owner < BUSY_ORG.bots % people.length ? Math.ceil(BUSY_ORG.bots / people.length) : Math.floor(BUSY_ORG.bots / people.length);
    for (let index = 0; index < count; index += 1) {
      const section = `Section ${(bots.length) % BUSY_ORG.sections}`;
      const made = await org.api("POST", "/api/bots", auth, { name: `Bot ${owner}-${index}`, section });
      if (made.status >= 300) throw new Error(`bot not made: ${made.status} ${JSON.stringify(made.body).slice(0, 300)}`);
      bots.push({ id: made.body.bot.id as string, owner });
    }
  }
  await org.kill("SIGTERM");
  const data = join(org.home, ".sagax");
  const routines = busyOrgRoutinesDocument(now, bots.map((bot) => bot.id));
  writeFileSync(join(data, "routines.json"), JSON.stringify(routines), { mode: 0o600 });
  // every kept run's conversation, and each bot's people's conversations
  const runs = routines.runs as Array<{ id: string; botId: string; threadId?: string; routineName: string }>;
  const seedFile = join(org.home, "busy-org-threads.json");
  writeFileSync(seedFile, JSON.stringify({
    now, topicsPerBot: BUSY_ORG.topicsPerBot, rowsPerTopic: BUSY_ORG.rowsPerTopic,
    routineThreads: runs.filter((run) => run.threadId).map((run) => ({ botId: run.botId, threadId: run.threadId, runId: run.id, title: run.routineName })),
  }));
  const threads = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "busy-org-threads.ts"), seedFile], {
    env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: org.home, USERPROFILE: org.home }, encoding: "utf8",
  });
  if (threads.status !== 0) throw new Error(`conversations not made: ${threads.stderr.slice(-2000)}`);
  const made = JSON.parse(threads.stdout.trim().split("\n").at(-1)!) as { cut: BusyOrgCutRow };
  mkdirSync(join(data, "org-library"), { recursive: true, mode: 0o700 });
  writeFileSync(join(data, "org-library", "presets.json"), JSON.stringify(busyOrgPresetsDocument(now), null, 2), { mode: 0o600 });
  return { people, bots, cut: made.cut };
}
