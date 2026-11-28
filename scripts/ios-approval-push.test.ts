// The simulator checklist of #5537 runs on files this script writes, so the
// rows are only worth running while they still say what the server sends and
// what the phone collapses on. This reads the rows against the server's own
// builders and the app's bundle id.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  APPROVAL_CATEGORY, OPEN_CATEGORY, QUESTION_CATEGORY, UPDATE_CATEGORY,
  collapseId,
} from "../server/push/payload.ts";
import { CHOICE_BUTTONS_MAX } from "../shared/notification-context.ts";
import {
  SIM_APPROVAL_REQUEST, SIM_BUNDLE_ID, SIM_QUESTION_REQUEST, SIM_THREAD,
  pushRows, writePushRows,
} from "./ios-approval-push.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const rows = pushRows();
const row = (file: string) => rows.find((one) => one.file === file)!;
const aps = (file: string) => (row(file).push as { aps: Record<string, unknown> }).aps;
const body = (file: string) => String((aps(file).alert as { body: string }).body);

describe("the simulator approval pushes of #5537", () => {
  it("are one row per thing the checklist checks, each named for it", () => {
    expect(rows.map((one) => one.file)).toEqual([
      "1-approval.push", "2-question.push", "3-question-open.push", "4-answered.push",
    ]);
    // every row says what to look at, what it must show, and what stays device-only
    for (const one of rows) {
      expect(one.title.length, one.file).toBeGreaterThan(3);
      expect(one.shows.length, one.file).toBeGreaterThan(10);
      expect(one.deviceOnly.length, one.file).toBeGreaterThan(3);
    }
  });

  it("target the app the simulator runs", () => {
    const project = readFileSync(join(ROOT, "ios", "project.yml"), "utf8");
    expect(project).toContain(`PRODUCT_BUNDLE_IDENTIFIER: ${SIM_BUNDLE_ID}`);
    for (const one of rows) {
      expect(one.push["Simulator Target Bundle"], one.file).toBe(SIM_BUNDLE_ID);
      // the payload the phone reads, not an APNs envelope around it
      expect(one.push.aps, one.file).toBeTruthy();
      expect(one.push.payload, one.file).toBeUndefined();
    }
  });

  it("send the approval ask with the actions the app registered", () => {
    expect(aps("1-approval.push").category).toBe(APPROVAL_CATEGORY);
    expect(row("1-approval.push").push.requestId).toBe(SIM_APPROVAL_REQUEST);
    expect(row("1-approval.push").push.threadId).toBe(SIM_THREAD);
    // what waits on the person wakes the screen
    expect(aps("1-approval.push")["interruption-level"]).toBe("time-sensitive");
    expect(body("1-approval.push")).toContain("npm publish");
  });

  it("carry the settled push on the ask's own collapse id, quietly", () => {
    const settled = row("4-answered.push");
    // the ask's banner leaves by that id alone: never the other asks of the
    // same conversation, and never a new banner beside it
    expect(settled.collapseId).toBe(row("1-approval.push").collapseId);
    expect(settled.collapseId).toBe(collapseId({ kind: "approval", threadId: SIM_THREAD, requestId: SIM_APPROVAL_REQUEST }));
    expect(settled.push.requestId).toBe(SIM_APPROVAL_REQUEST);
    expect(aps("4-answered.push").category).toBe(UPDATE_CATEGORY);
    expect(aps("4-answered.push")["interruption-level"]).toBe("passive");
    expect(aps("4-answered.push")["mutable-content"]).toBe(1);
    expect(body("4-answered.push")).toBe("Answered.");
  });

  it("keep each ask under its own collapse id", () => {
    const question = row("2-question.push");
    expect(question.collapseId).toBe(collapseId({ kind: "approval", threadId: SIM_THREAD, requestId: SIM_QUESTION_REQUEST }));
    expect(question.collapseId).not.toBe(row("1-approval.push").collapseId);
    expect(question.collapseId).not.toBe(row("3-question-open.push").collapseId);
  });

  it("offer the choices of a question only when a button can hold them whole", () => {
    const short = row("2-question.push");
    expect(aps("2-question.push").category).toBe(QUESTION_CATEGORY);
    expect(short.push.choices).toEqual(["Staging", "Production"]);
    expect(short.push.choiceLabels).toEqual(["Staging", "Production"]);
    // #2909: past what fits, the banner offers Open and carries no answers
    const long = row("3-question-open.push");
    expect((long.push as { choices?: string[] }).choices).toBeUndefined();
    expect((long.push as { choiceLabels?: string[] }).choiceLabels).toBeUndefined();
    expect(aps("3-question-open.push").category).toBe(OPEN_CATEGORY);
    expect((short.push as { choices: string[] }).choices.length).toBeLessThanOrEqual(CHOICE_BUTTONS_MAX);
    expect(long.title).toMatch(/cannot hold/);
  });

  it("write files a simulator can be handed", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-approval-push-test-"));
    try {
      const written = writePushRows(dir);
      expect(written.dir).toBe(dir);
      expect(written.files.map((file) => file.split("/").pop())).toEqual(rows.map((one) => one.file));
      for (const file of written.files) {
        expect(existsSync(file), file).toBe(true);
        expect(() => JSON.parse(readFileSync(file, "utf8"))).not.toThrow();
        // the path is absolute, which is what simctl takes
        expect(resolve(file)).toBe(file);
      }
      expect(JSON.parse(readFileSync(join(dir, "1-approval.push"), "utf8")).aps.category).toBe(APPROVAL_CATEGORY);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
