// The approval banners the iOS simulator can show, as `xcrun simctl push`
// files (#5537). The payloads come from the server's own builders
// (`server/push/payload.ts`), so a banner written here is what APNs would
// send, not a hand-written guess of it.
//
// The simulator never runs the Notification Service Extension on an unsigned
// build (docs/verification/approval-notifications.md), so these rows prove
// what the app registers itself, and each row says plainly what it cannot
// prove without a phone. The checklist lives in that recipe.
//
//   node --experimental-strip-types scripts/ios-approval-push.ts
//   node --experimental-strip-types scripts/ios-approval-push.ts --push
//   node --experimental-strip-types scripts/ios-approval-push.ts --row question --push
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { buildApnsRequest, buildSettledRequest, type PushMessage } from "../server/push/payload.ts";

/// The app's bundle id (`ios/project.yml`), which is what a `.push` file
/// names as its target.
export const SIM_BUNDLE_ID = "ca.pulsatrix.sagax";
/// One conversation of the fixture, so every row collapses where the phone
/// will collapse it. Neutral names only (AGENTS.md, "Checks and tests").
export const SIM_THREAD = "sim-approvals-thread";
/// The approval ask and the question ask: two requests, two banners.
export const SIM_APPROVAL_REQUEST = "sim-approvals-ask";
export const SIM_QUESTION_REQUEST = "sim-approvals-question";

export interface PushRow {
  /// File name inside the output folder, also the `--row` name without `.push`.
  file: string;
  /// What the row asks the person to look at.
  title: string;
  /// The buttons or the text the row must produce on the screen.
  shows: string;
  /// What this row cannot prove in the simulator, and where it is proven.
  deviceOnly: string;
  /// The `.push` file's JSON: the target bundle plus the APNs body.
  push: Record<string, unknown>;
  /// The `apns-collapse-id` the same ask would go out under. The simulator
  /// ignores it; it is printed so the row can be compared with a phone.
  collapseId: string;
}

const NOW_MS = Date.parse("2026-11-28T12:00:00Z");

const sender = { senderName: "Nimbus", senderId: "sim-approvals-bot" };

const approvalMessage: PushMessage = {
  kind: "approval", prompt: "approval", personId: "sim-person",
  title: "Nimbus needs approval", body: "Nimbus wants to run npm publish.",
  ask: "Publish the package to the registry?",
  threadId: SIM_THREAD, botId: "sim-approvals-bot", requestId: SIM_APPROVAL_REQUEST,
  cardId: "sim-approvals-card", ...sender, at: NOW_MS,
};

const questionMessage: PushMessage = {
  kind: "approval", prompt: "question", personId: "sim-person",
  title: "Nimbus has a question", body: "Which environment should I deploy to?",
  threadId: SIM_THREAD, botId: "sim-approvals-bot", requestId: SIM_QUESTION_REQUEST,
  choices: ["Staging", "Production"], choiceLabels: ["Staging", "Production"],
  cardId: "sim-approvals-question-card", ...sender, at: NOW_MS,
};

// Five answers, and none of them short enough to title a button: the server
// sends no choices at all and the banner offers Open (#2909).
const longQuestionMessage: PushMessage = {
  ...questionMessage,
  requestId: `${SIM_QUESTION_REQUEST}-long`,
  choices: [
    "Staging first, then production once the smoke suite is green",
    "Production straight away, the change is a documentation fix",
    "Staging only, and tell the channel when it is up",
    "Neither yet, wait for the release cut",
    "Both, but hold the migration until I say so",
  ],
};

const pushRow = (file: string, title: string, shows: string, deviceOnly: string, message: PushMessage): PushRow => {
  const request = buildApnsRequest({ message, bundleId: SIM_BUNDLE_ID, nowMs: NOW_MS });
  return {
    file, title, shows, deviceOnly, collapseId: request.headers["apns-collapse-id"]!,
    push: { "Simulator Target Bundle": SIM_BUNDLE_ID, ...JSON.parse(request.body) as Record<string, unknown> },
  };
};

/// The rows, in the order the checklist runs them.
export function pushRows(): PushRow[] {
  const settled = buildSettledRequest({
    threadId: SIM_THREAD, requestId: SIM_APPROVAL_REQUEST, bundleId: SIM_BUNDLE_ID, nowMs: NOW_MS,
  });
  return [
    pushRow("1-approval.push", "An approval ask", "Allow once and Deny as banner buttons.",
      "The bot's face and its whole context: only the extension adds those, and it never runs here.",
      approvalMessage),
    pushRow("2-question.push", "A question with short answers", "Reply with a text field: the choice buttons are the extension's work, so they are absent here.",
      "The choice buttons: only the app's own live banner registers their category, which needs a paired desktop session.",
      questionMessage),
    pushRow("3-question-open.push", "A question the buttons cannot hold", "One Open button, and no cut-off answer.",
      "Nothing device-only: the phone offers Open for this too.",
      longQuestionMessage),
    {
      file: "4-answered.push",
      title: "The approval answered elsewhere (settled)",
      shows: "A quiet \"Answered.\" line, no sound: the simulator has no extension to swallow the push.",
      deviceOnly: "The silent removal itself: on a phone the extension takes the ask down and shows nothing.",
      collapseId: settled.headers["apns-collapse-id"]!,
      push: { "Simulator Target Bundle": SIM_BUNDLE_ID, ...JSON.parse(settled.body) as Record<string, unknown> },
    },
  ];
}

/// Writes the rows into `dir` (default: a folder under the system temp dir)
/// and returns where each went.
export function writePushRows(dir: string = join(tmpdir(), "sagax-approval-push")): { dir: string; files: string[] } {
  mkdirSync(dir, { recursive: true });
  const files = pushRows().map((row) => {
    const path = join(dir, row.file);
    writeFileSync(path, `${JSON.stringify(row.push, null, 2)}\n`, "utf8");
    return path;
  });
  return { dir, files };
}

/// Sends one file to a simulator: `xcrun simctl push booted <file>`, or to a
/// device UDID with `--udid`.
export function pushToSimulator(file: string, udid: string = "booted"): void {
  execFileSync("xcrun", ["simctl", "push", udid, file], { stdio: "inherit" });
}

const usage = () => `usage: node --experimental-strip-types scripts/ios-approval-push.ts [options]

  --out DIR    where to write the .push files (default: a temp folder)
  --row NAME   only one row, without .push (1-approval, 2-question, 3-question-open, 4-answered)
  --push       send what was written to a simulator
  --udid X     the simulator to send to (default: booted)
  --list       print the rows and exit`;

function main(argv: string[]): void {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return;
  }
  const rows = pushRows();
  if (argv.includes("--list")) {
    for (const row of rows) {
      console.log(`${row.file.replace(/\.push$/, "")}\t${row.title}\n  shows: ${row.shows}\n  not here: ${row.deviceOnly}\n  collapse: ${row.collapseId}`);
    }
    return;
  }
  const wanted = value("--row");
  const written = writePushRows(value("--out"));
  const picked = wanted ? rows.filter((row) => row.file === `${wanted}.push`) : rows;
  if (wanted && !picked.length) {
    console.error(`no such row: ${wanted} (try: ${rows.map((row) => row.file.replace(/\.push$/, "")).join(", ")})`);
    process.exitCode = 1;
    return;
  }
  console.log(`push files in ${written.dir}`);
  for (const row of picked) {
    const path = join(written.dir, row.file);
    console.log(`\n${row.file}\n  ${row.title}\n  shows: ${row.shows}\n  not in the simulator: ${row.deviceOnly}\n  collapse id on a phone: ${row.collapseId}`);
    if (argv.includes("--push")) pushToSimulator(path, value("--udid") ?? "booted");
  }
}

if (process.argv[1] && process.argv[1].endsWith("ios-approval-push.ts")) main(process.argv.slice(2));
