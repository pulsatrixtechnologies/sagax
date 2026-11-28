import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { anonymizePair, mulberry32 } from "./anonymize.ts";
import { runBothFixtures } from "./fixtures/assistants.ts";
import { judgePair } from "./judge.ts";
import { loadFrozenTasks, manifestDigest } from "./protocol.ts";
import {
  CRITERIA,
  FAMILIES,
  type BlindPairReport,
  type Criterion,
  type Family,
  type PairVerdict,
} from "./types.ts";

/** Offline blind-pair runner (#5533). Freezes the rubric under sha256, runs
 * two scripted fixtures with the same prompt and context, anonymizes the
 * sides, and reports gaps per criterion with no global score. */

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = join(HERE, "..", "reports", "runs");

export type RunOptions = {
  seed?: number;
  families?: Family[];
  reveal?: boolean;
  outDir?: string;
};

function parseFamilies(raw: string | undefined): Family[] | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    if (!(FAMILIES as readonly string[]).includes(part)) {
      throw new Error("unknown family " + part + "; known: " + FAMILIES.join(", "));
    }
  }
  return parts as Family[];
}

function emptyGaps(): BlindPairReport["gapsByCriterion"] {
  return Object.fromEntries(
    CRITERIA.map((criterion) => [criterion, { aFails: 0, bFails: 0, compared: 0 }]),
  ) as BlindPairReport["gapsByCriterion"];
}

export function runBlindPair(options: RunOptions = {}): BlindPairReport {
  const seed = options.seed ?? 5533;
  const { manifest, tasks } = loadFrozenTasks(undefined, options.families);
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const pairs: PairVerdict[] = [];
  const gapsByCriterion = emptyGaps();

  // Shuffle task order so a sitting never always starts on the same family.
  const order = tasks
    .map((task, index) => ({ task, weight: rand(), index }))
    .sort((left, right) => left.weight - right.weight || left.index - right.index);

  for (const { task, index } of order) {
    const [left, right] = runBothFixtures(task);
    const pairSeed = (seed + index * 997) >>> 0;
    const assignment = anonymizePair(left, right, pairSeed);
    const gaps = judgePair(task, assignment.sides[0], assignment.sides[1]);
    for (const gap of gaps) {
      const bucket = gapsByCriterion[gap.criterion as Criterion];
      if (gap.assistantA === "n/a" && gap.assistantB === "n/a") continue;
      bucket.compared += 1;
      if (gap.assistantA === "fail") bucket.aFails += 1;
      if (gap.assistantB === "fail") bucket.bFails += 1;
    }
    pairs.push({
      taskId: task.id,
      family: task.family,
      assignment: {
        assistantA: assignment.assistantA,
        assistantB: assignment.assistantB,
      },
      sides: assignment.sides,
      gaps,
    });
  }

  const families = [...new Set(pairs.map((pair) => pair.family))] as Family[];
  const published = options.reveal
    ? pairs
    : pairs.map((pair) => ({
      ...pair,
      // Seal the coin flip so a default report stays blind.
      assignment: { assistantA: "sealed" as const, assistantB: "sealed" as const },
    }));
  return {
    version: 1,
    manifestVersion: manifest.version,
    manifestSha256: manifestDigest(manifest),
    seed,
    pairCount: pairs.length,
    families,
    pairs: published,
    gapsByCriterion,
  };
}

/** Public helper used by tests: always keeps the real assignment so a
 * unit test can assert the coin flip without --reveal. */
export function runBlindPairRevealed(options: RunOptions = {}): BlindPairReport {
  return runBlindPair({ ...options, reveal: true });
}

function renderMarkdown(report: BlindPairReport, revealed: boolean): string {
  const lines: string[] = [];
  lines.push("# Blind-pair report");
  lines.push("");
  lines.push("- Manifest: " + report.manifestVersion + " (" + report.manifestSha256.slice(0, 12) + "...)");
  lines.push("- Seed: " + report.seed);
  lines.push("- Pairs: " + report.pairCount);
  lines.push("- Families: " + report.families.join(", "));
  lines.push("- Assignment revealed: " + (revealed ? "yes" : "no"));
  lines.push("");
  lines.push("## Gaps by criterion");
  lines.push("");
  lines.push("| Criterion | Compared | Assistant A fails | Assistant B fails |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const criterion of CRITERIA) {
    const row = report.gapsByCriterion[criterion];
    if (row.compared === 0) continue;
    lines.push("| " + criterion + " | " + row.compared + " | " + row.aFails + " | " + row.bFails + " |");
  }
  lines.push("");
  lines.push("No overall score is computed; compare the columns per criterion.");
  lines.push("");
  lines.push("## Pairs");
  lines.push("");
  for (const pair of report.pairs) {
    lines.push("### " + pair.taskId + " (" + pair.family + ")");
    if (revealed) {
      lines.push("- Assistant A was `" + pair.assignment.assistantA + "`");
      lines.push("- Assistant B was `" + pair.assignment.assistantB + "`");
    }
    for (const side of pair.sides) {
      lines.push("- **" + side.label + "** (" + side.latencyMs + " ms): " + side.text.replace(/\n/g, " / "));
    }
    for (const gap of pair.gaps) {
      lines.push("- " + gap.criterion + ": A=" + gap.assistantA + ", B=" + gap.assistantB + " (" + gap.detail + ")");
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function writeReport(report: BlindPairReport, outDir: string, revealed: boolean): { json: string; md: string } {
  mkdirSync(outDir, { recursive: true });
  const stamp = "blind-pair-" + report.seed + "-" + report.manifestVersion;
  const jsonPath = join(outDir, stamp + ".json");
  const mdPath = join(outDir, stamp + ".md");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(mdPath, renderMarkdown(report, revealed));
  return { json: jsonPath, md: mdPath };
}

function main(argv: string[]): void {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    // pnpm forwards a bare "--"; skip it.
    if (token === "--" || !token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args.set(key, "true");
    } else {
      args.set(key, next);
      i += 1;
    }
  }
  const seed = args.has("seed") ? Number(args.get("seed")) : 5533;
  if (!Number.isFinite(seed)) throw new Error("--seed must be a number");
  const reveal = args.get("reveal") === "true";
  const families = parseFamilies(args.get("family") ?? args.get("families"));
  const outDir = args.get("out") ?? DEFAULT_OUT;
  const report = runBlindPair({ seed, families, reveal });
  const paths = writeReport(report, outDir, reveal);
  console.log("blind-pair: " + report.pairCount + " pairs across " + report.families.join(", "));
  console.log("blind-pair: manifest " + report.manifestVersion + " sha256 " + report.manifestSha256);
  console.log("blind-pair: wrote " + paths.json);
  console.log("blind-pair: wrote " + paths.md);
  for (const criterion of CRITERIA) {
    const row = report.gapsByCriterion[criterion];
    if (row.compared === 0) continue;
    console.log(
      "blind-pair: " + criterion + " compared=" + row.compared
      + " A_fails=" + row.aFails + " B_fails=" + row.bFails,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
