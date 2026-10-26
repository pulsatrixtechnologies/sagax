// Settings > Computer > Other computers (parity 2E): rename and remove one of
// the person's computers (server/desktop-bridge.ts).
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DesktopBridges, type DesktopBridgeRegistration } from "./desktop-bridge.ts";

const ADA = "pr_11111111-1111-4111-8111-111111111111";
const BOB = "pr_22222222-2222-4222-8222-222222222222";
const secret = "b".repeat(64);
const registration = (name: string): DesktopBridgeRegistration => ({
  id: randomUUID(), name, platform: "darwin", attachmentsDir: "/var/folders/x/T/Sagax/attachments",
  capabilities: { shell: true, files: true, fetch: true, browser: true, computer: false, localVm: true },
});

function setup() {
  let at = 1_000_000;
  const bridges = new DesktopBridges((session) => (session.startsWith("ada") ? ADA : session.startsWith("bob") ? BOB : null), () => at);
  const ada = registration("Ada's Mac");
  const office = registration("Office PC");
  bridges.register(ada, "ada-1", secret);
  bridges.register(office, "ada-2", secret);
  bridges.register(registration("Bob's Mac"), "bob-1", secret);
  return { bridges, ada, office, later: (ms: number) => { at += ms; } };
}

describe("renaming one of the person's computers", () => {
  it("keeps the new name for the list, by id or by the old name", () => {
    const { bridges, ada } = setup();
    expect(bridges.rename(ADA, ada.id, "  Desk Mac  ")).toEqual({ id: ada.id, name: "Desk Mac" });
    expect(bridges.status(ADA).map((entry) => entry.name).sort()).toEqual(["Desk Mac", "Office PC"]);
    expect(bridges.rename(ADA, "office pc", "Laptop").name).toBe("Laptop");
    expect(bridges.inventory().find((entry) => entry.id === ada.id)?.name).toBe("Desk Mac");
  });
  it("refuses an empty, too long or control-character name, another person's computer and an unknown one", () => {
    const { bridges, ada } = setup();
    for (const name of ["", "   ", "x".repeat(121), "a\nb"]) expect(() => bridges.rename(ADA, ada.id, name)).toThrow(/1 to 120/);
    expect(() => bridges.rename(BOB, ada.id, "Mine")).toThrow(/not in your list/);
    expect(() => bridges.rename(ADA, "nope", "Mine")).toThrow(/not in your list/);
    expect(() => bridges.rename(null, ada.id, "Mine")).toThrow(/Sign in/);
  });
  it("asks for more when two computers have the same name", () => {
    const { bridges } = setup();
    bridges.register(registration("Office PC"), "ada-3", secret);
    expect(() => bridges.rename(ADA, "Office PC", "Other")).toThrow(/Several computers/);
  });
});

describe("removing one of the person's computers", () => {
  it("is refused while the computer is online", () => {
    const { bridges, ada } = setup();
    expect(() => bridges.remove(ADA, ada.id)).toThrow(/online/);
    expect(bridges.status(ADA)).toHaveLength(2);
  });
  it("takes an offline computer off the list and forgets its name", () => {
    const { bridges, ada, later } = setup();
    bridges.rename(ADA, ada.id, "Desk Mac");
    later(60_000);
    expect(bridges.remove(ADA, "Desk Mac")).toEqual({ id: ada.id });
    expect(bridges.status(ADA).map((entry) => entry.id)).not.toContain(ada.id);
    expect(bridges.status(BOB)).toHaveLength(1);
  });
  it("lets only ten removals a minute through", () => {
    const { bridges, later } = setup();
    const pcs = Array.from({ length: 11 }, (_, index) => registration(`PC ${index}`));
    pcs.forEach((entry, index) => bridges.register(entry, `ada-pc-${index}`, secret));
    later(60_000);
    for (const entry of pcs.slice(0, 10)) bridges.remove(ADA, entry.id);
    expect(() => bridges.remove(ADA, pcs[10]!.id)).toThrow(/Too many removals/);
    later(61_000);
    expect(bridges.remove(ADA, pcs[10]!.id)).toEqual({ id: pcs[10]!.id });
  });
});

describe("a computer's name across a server restart", () => {
  it("is kept on disk and read back by a new server", () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-names-"));
    try {
      const file = join(dir, "names.json");
      const sessions = (session: string) => (session.startsWith("ada") ? ADA : null);
      const first = new DesktopBridges(sessions, Date.now, file);
      const mac = registration("Ada's Mac");
      first.register(mac, "ada-1", secret);
      first.rename(ADA, mac.id, "Desk Mac");
      const second = new DesktopBridges(sessions, Date.now, file);
      second.register(mac, "ada-9", secret);
      expect(second.status(ADA)[0]?.name).toBe("Desk Mac");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
