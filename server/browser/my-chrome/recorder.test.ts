// The My Chrome recorder's rules on what the page reports, without a browser:
// secrets never kept (the page's word, the field, the text, a digest seen
// earlier), notes, and the page script's own refusals.
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { MyChromeRecording, recorderPageScript, RECORDER_BINDING } from "./recorder.ts";

// #4164: a step id is a random UUID, hex digits that held "4321" (the PIN
// below) about once in five hundred runs and turned the secret check red on a
// runner. Every id here holds those digits, so the check must read what the
// page reported, never the ids, and stays the same on every run.
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  let next = 0;
  return { ...actual, randomUUID: () => `00004321-4321-4321-8321-${String(++next).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}` };
});

const target = (name: string, extra: Record<string, unknown> = {}) => ({ role: "textbox", name, tag: "input", ...extra });
const send = (recording: MyChromeRecording, message: Record<string, unknown>) => recording.fromPage(JSON.stringify(message));

describe("MyChromeRecording", () => {
  it("keeps ordinary text, and never a secret one, whoever calls it secret", () => {
    const recording = new MyChromeRecording();
    send(recording, { t: "type", url: "https://app.example.com/f", target: target("Name"), field: { tag: "input", type: "text", name: "Name" }, value: "Alice" });
    // the page says secret: no value came, the step says a secret goes there
    send(recording, { t: "type", url: "https://app.example.com/f", target: target("Password"), field: { tag: "input", type: "password" }, secret: true });
    // the page sent a value, but the server sees a secret field by its name
    send(recording, { t: "type", url: "https://app.example.com/f", target: target("PIN"), field: { tag: "input", type: "text", fieldName: "pin" }, value: "4321" });
    // a credential typed in an ordinary field
    send(recording, { t: "type", url: "https://app.example.com/f", target: target("Notes"), field: { tag: "input", type: "text" }, value: "ghp_abcdefghijklmnopqrstuvwxyz1234567890" });
    // a secret typed earlier and pasted into an ordinary field later
    send(recording, { t: "digest", digest: createHash("sha256").update("correct horse").digest("hex") });
    send(recording, { t: "type", url: "https://app.example.com/f", target: target("Comment"), field: { tag: "input", type: "text" }, value: "correct horse " });
    const steps = recording.result();
    expect(steps.map((step) => [step.target?.name, step.text ?? null, step.secret ?? false])).toEqual([
      ["Name", "Alice", false], ["Password", null, true], ["PIN", null, true], ["Notes", null, true], ["Comment", null, true],
    ]);
    expect(steps.every((step) => step.id.includes("4321"))).toBe(true);
    expect(JSON.stringify(steps.map(({ id: _id, ...step }) => step))).not.toMatch(/4321|ghp_|correct horse/);
  });

  it("records clicks and Enter or Escape only, strips credentials from addresses, and stops from the tab", async () => {
    const recording = new MyChromeRecording();
    send(recording, { t: "click", url: "https://user:pw@app.example.com/x?token=abc", target: { role: "button", name: "Save", tag: "button", selector: "#save" } });
    send(recording, { t: "press", key: "Enter" });
    send(recording, { t: "press", key: "a" });
    send(recording, { t: "nonsense" });
    recording.fromPage("not json");
    expect(recording.note("Check the total")).toBe(true);
    expect(recording.note("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefgh")).toBe(false);
    const steps = recording.result();
    expect(steps.map((step) => step.kind)).toEqual(["click", "press", "note"]);
    expect(steps[0]!.url).toBe("https://app.example.com/x?token=REDACTED");
    expect(steps[0]!.target?.selector).toBe("#save");
    send(recording, { t: "stop" });
    await Promise.resolve();
    expect(recording.status()).toMatchObject({ recording: false, ended: "tab", steps: 3 });
    // nothing more is recorded once it ended
    send(recording, { t: "click", target: { role: "button", name: "Late", tag: "button" } });
    expect(recording.note("late")).toBe(false);
    expect(recording.result()).toHaveLength(3);
  });

  it("has a page script that counts only trusted events and never sends a secret field's value", () => {
    const script = recorderPageScript();
    expect(script).toContain(RECORDER_BINDING);
    expect(script.match(/event\.isTrusted/g)?.length).toBeGreaterThanOrEqual(4);
    // the secret branch sends no value
    expect(script).toMatch(/if \(secretField\(el, field\)\) \{\n\s*send\(\{ t: "type", url: location\.href, target, field, secret: true \}\);/);
    expect(() => new Function(script)).not.toThrow();
  });
});
