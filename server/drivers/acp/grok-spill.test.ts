// #5157: a Grok turn that loads the account's grok.com connectors must not
// leave a connector file's bytes under GROK_HOME after the turn.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { clearGrokConnectorSpill } from "./grok-spill.ts";

const root = mkdtempSync(join(tmpdir(), "sagax-grok-spill-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("clearGrokConnectorSpill", () => {
  it("after the turn, a connector file's bytes are gone from the session folder", () => {
    const home = join(root, "home");
    const realSessions = join(root, "real-sessions");
    mkdirSync(home);
    const session = join(realSessions, "cwd-key", "session-1");
    mkdirSync(join(session, "mcp"), { recursive: true });
    symlinkSync(realSessions, join(home, "sessions"));
    const payload = Buffer.concat([Buffer.from("QUOKKA-FILE-BYTES-"), Buffer.alloc(400, 7)]).toString("base64");
    expect(payload.length).toBeGreaterThan(256);
    const spill = JSON.stringify({ result: { content: [{ type: "resource", resource: { blob: payload } }] } });
    writeFileSync(join(session, "mcp", "call_0.json"), spill);
    writeFileSync(join(session, "updates.jsonl"), `${JSON.stringify({ blob: payload })}\n${JSON.stringify({ text: "kept note" })}\n`);
    writeFileSync(join(session, "chat_history.jsonl"), JSON.stringify({ content: payload }));
    writeFileSync(join(home, "auth.json"), JSON.stringify({ token: "not-the-file" }));

    expect(clearGrokConnectorSpill(home)).toBeGreaterThan(0);

    expect(existsSync(join(session, "mcp", "call_0.json"))).toBe(false);
    const left = [
      readFileSync(join(session, "updates.jsonl"), "utf8"),
      readFileSync(join(session, "chat_history.jsonl"), "utf8"),
      readFileSync(join(home, "auth.json"), "utf8"),
    ].join("\n");
    expect(left).not.toContain(payload);
    expect(left).toContain("kept note");
    expect(left).toContain("not-the-file");
  });
});
