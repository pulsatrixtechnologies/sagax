import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { sandboxDesktopTarget } from "../desktop-viewer-targets.ts";
import { SandboxControlHolds } from "./sandbox-control.ts";

const ALICE = "pr_00000000-0000-4000-8000-00000000000a";

function fakeManager() {
  const streams: PassThrough[] = [];
  return {
    streams,
    manager: {
      openDesktop: async () => ({ full: "fullpass", view: "viewpass" }),
      desktopStream: async () => { const stream = new PassThrough(); streams.push(stream); return stream; },
      pendingDeletionAt: () => null,
    },
  };
}

describe("taking control of the server environment desktop", () => {
  it("holds while a control view is open, and only then", async () => {
    const holds = new SandboxControlHolds();
    const { manager, streams } = fakeManager();
    const target = sandboxDesktopTarget(manager, ALICE, (person) => holds.hold(person));

    const watching = await target.resolve({ upgrade: true, control: false });
    await watching.stream!();
    expect(holds.held(ALICE)).toBe(false);

    const controlling = await target.resolve({ upgrade: true, control: true });
    await controlling.stream!();
    const second = await target.resolve({ upgrade: true, control: true });
    await second.stream!();
    expect(holds.held(ALICE)).toBe(true);
    expect(holds.held(ALICE.toUpperCase())).toBe(true);

    streams[1]!.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    expect(holds.held(ALICE)).toBe(true);
    streams[2]!.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    expect(holds.held(ALICE)).toBe(false);
  });

  it("gives the full password only to a control view", async () => {
    const { manager } = fakeManager();
    const target = sandboxDesktopTarget(manager, ALICE);
    expect(await target.resolve({ upgrade: false, control: false })).toMatchObject({ password: "viewpass", viewOnly: true });
    expect(await target.resolve({ upgrade: false, control: true })).toMatchObject({ password: "fullpass", viewOnly: false });
  });

  it("releases each hold once", () => {
    const holds = new SandboxControlHolds();
    const release = holds.hold(ALICE);
    holds.hold(ALICE)();
    release();
    release();
    expect(holds.held(ALICE)).toBe(false);
  });
});
