#!/usr/bin/env -S node --experimental-strip-types
// Reliability qualification runner (lot 6 of the Sagax / Grok Bot convergence).
//
//   node --experimental-strip-types scripts/qualification/run.ts [options]
//
//   --out DIR                 where report.json and report.md go (default: a temporary folder)
//   --only ID,ID              run only these task ids
//   --category NAME,NAME      run only these categories
//   --engines fake|real       fake (default, deterministic) or real (opt-in, see below)
//   --compare FILE            merge a manual Grok Bot report (JSON) with this run into comparison.md
//   --emit-corpus FILE        write the human-readable corpus (generated, committed as corpus-v1.md)
//   --emit-grok-template FILE write the blank manual report to fill in for Grok Bot
//   --label TEXT              what answered, for the report title
//
// Real engines (never run by tests or agents; provider charges may apply to the
// person's own account): QUALIFY_REAL_ENGINE=1 plus
//   --confirm-real-spend --real-cli /abs/path/to/engine-cli --real-model MODEL --real-pass-env NAME,NAME
// Names only: the values are copied from this process into the isolated server's
// temporary 0600 config for the run and deleted with it. Tasks that need an
// injected fault (limit, restart, held tool) are skipped on a real engine.
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { CORPUS, CORPUS_IDS, CORPUS_VERSION, CATEGORIES, renderCorpusMarkdown, type TaskDefinition } from "./corpus.ts";
import { TaskContext, judge } from "./context.ts";
import { fakeProfile, realProfile, type EngineProfile } from "./engines.ts";
import { QualServer } from "./harness.ts";
import { blankRecord, buildReport, compare, renderComparison, renderReport, validateManualReport, type RunReport, type TaskRecord } from "./model.ts";
import { KINDS } from "./scenarios.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TASK_TIMEOUT_MS = 180_000;

const live = new Set<QualServer>();

async function runTask(def: TaskDefinition, profile: EngineProfile): Promise<TaskRecord> {
  const factory = KINDS[def.kind];
  if (!factory) throw new Error(`corpus task ${def.id} names an unknown kind ${def.kind}`);
  const scenario = factory(def);
  const started = performance.now();
  let server: QualServer | undefined;
  let ctx: TaskContext | undefined;
  let failure: unknown;
  try {
    server = await QualServer.start({ ...scenario.server(), profile });
    live.add(server);
    ctx = new TaskContext(server, profile, def);
    await ctx.openStream();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      scenario.run(ctx),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`task timed out after ${TASK_TIMEOUT_MS / 1000} s`)), TASK_TIMEOUT_MS); }),
    ]).finally(() => clearTimeout(timer));
  } catch (error) {
    failure = error;
  }
  try {
    if (!ctx) {
      const record = blankRecord({ id: def.id, category: def.category, title: def.title, engine: profile.kind });
      record.status = "error";
      record.defects.push(`server did not start: ${failure instanceof Error ? failure.message : String(failure)}`);
      return record;
    }
    return await judge(ctx, performance.now() - started, failure);
  } finally {
    try { await ctx?.sse?.closed(); } catch { /* already closed */ }
    if (server) {
      await server.close();
      live.delete(server);
    }
  }
}

function revision(): string {
  try { return execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "unknown"; }
}

export function selectTasks(only: string[], categories: string[]): TaskDefinition[] {
  const unknown = only.filter((id) => !CORPUS_IDS.includes(id));
  if (unknown.length) throw new Error(`unknown task id(s): ${unknown.join(", ")}`);
  const badCategories = categories.filter((name) => !(CATEGORIES as readonly string[]).includes(name));
  if (badCategories.length) throw new Error(`unknown categor(ies): ${badCategories.join(", ")}`);
  return CORPUS.filter((task) => (!only.length || only.includes(task.id)) && (!categories.length || categories.includes(task.category)));
}

export function grokTemplate(): RunReport {
  const tasks = CORPUS.map((task) => {
    const record = blankRecord({ id: task.id, category: task.category, title: task.title, engine: "grok-manual" });
    record.timed = task.timed;
    record.skipReason = task.manual === null ? "no Grok Bot equivalent" : undefined;
    record.notes = [task.manual === null ? "Leave skipped." : `How: ${task.manual}`];
    return record;
  });
  return buildReport({
    corpusVersion: CORPUS_VERSION, engine: "grok-manual", engineLabel: "Grok Bot, manual run (fill in version, device, date)",
    startedAt: "", finishedAt: "", revision: "manual", node: "n/a", tasks,
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: "string" }, only: { type: "string" }, category: { type: "string" }, engines: { type: "string", default: "fake" },
      compare: { type: "string" }, "emit-corpus": { type: "string" }, "emit-grok-template": { type: "string" }, label: { type: "string" },
      "confirm-real-spend": { type: "boolean", default: false }, "real-cli": { type: "string" }, "real-model": { type: "string" }, "real-pass-env": { type: "string" },
    },
    strict: true,
  });
  const split = (value: string | undefined) => (value ? value.split(",").map((part) => part.trim()).filter(Boolean) : []);

  if (values["emit-corpus"]) {
    writeFileSync(resolve(values["emit-corpus"]), renderCorpusMarkdown());
    process.stdout.write(`wrote ${values["emit-corpus"]}\n`);
    return;
  }
  if (values["emit-grok-template"]) {
    writeFileSync(resolve(values["emit-grok-template"]), `${JSON.stringify(grokTemplate(), null, 2)}\n`);
    process.stdout.write(`wrote ${values["emit-grok-template"]}\n`);
    return;
  }

  const outDir = resolve(values.out ?? mkdtempSync(join(tmpdir(), "sagax-qualification-report-")));
  mkdirSync(outDir, { recursive: true });

  let profile: EngineProfile;
  if (values.engines === "real") {
    profile = realProfile({
      confirmed: values["confirm-real-spend"] === true,
      cli: values["real-cli"] ?? "",
      model: values["real-model"] ?? "",
      passEnv: split(values["real-pass-env"]),
      label: values.label,
    });
  } else if (values.engines === "fake") {
    profile = fakeProfile();
  } else throw new Error("--engines must be fake or real");

  const tasks = selectTasks(split(values.only), split(values.category));
  const startedAt = new Date().toISOString();
  const records: TaskRecord[] = [];
  for (const def of tasks) {
    if (profile.kind === "real" && def.needsFakeEngine) {
      const record = blankRecord({ id: def.id, category: def.category, title: def.title, engine: "real" });
      record.skipReason = "needs a fault only a fake engine can inject";
      records.push(record);
      process.stdout.write(`${def.id.padEnd(15)} skipped (${record.skipReason})\n`);
      continue;
    }
    process.stdout.write(`${def.id.padEnd(15)} `);
    const record = await runTask(def, profile);
    records.push(record);
    process.stdout.write(`${record.status.padEnd(9)} ${record.finalMs === null ? "" : `${record.finalMs} ms `}${record.defects.length ? `<- ${record.defects[0]}` : ""}\n`);
  }

  const report = buildReport({
    corpusVersion: CORPUS_VERSION,
    engine: profile.kind,
    engineLabel: values.label ?? profile.label,
    startedAt,
    finishedAt: new Date().toISOString(),
    revision: revision(),
    node: process.version,
    tasks: records,
  });
  writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outDir, "report.md"), renderReport(report));
  process.stdout.write(`\ncompletion ${(report.summary.completionRate ?? 0) * 100}% lost ${report.summary.lostAccepted} dup replies ${report.summary.duplicateReplies} dup dispatches ${report.summary.duplicateDispatches}\nreport: ${outDir}\n`);

  if (values.compare) {
    const manual = JSON.parse(readFileSync(resolve(values.compare), "utf8")) as unknown;
    const problems = validateManualReport(manual, CORPUS_IDS);
    if (problems.length) throw new Error(`the Grok Bot report is not usable:\n- ${problems.join("\n- ")}`);
    const comparison = compare(report, manual as RunReport);
    writeFileSync(join(outDir, "comparison.md"), renderComparison(comparison));
    process.stdout.write(`comparison: ${join(outDir, "comparison.md")}\n`);
  }
  if (records.some((record) => record.status === "error" || record.status === "failed")) process.exitCode = 1;
}

const teardown = async () => {
  await Promise.all([...live].map((server) => server.close().catch(() => undefined)));
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => { void teardown().finally(() => process.exit(130)); });
  }
  main().catch(async (error) => {
    await teardown();
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }).then(teardown);
}
