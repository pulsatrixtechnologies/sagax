import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PersonSettingsStore, personalProfilePartition } from "../people/person-settings.ts";
import { createPersonSettingsRoutes, PERSON_SETTINGS_PATH } from "./person-settings.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function setup(principal: string | null = "alex") {
  const dir = mkdtempSync(join(tmpdir(), "sagax-person-settings-"));
  dirs.push(dir);
  const store = new PersonSettingsStore(dir);
  const saved: string[][] = [];
  const route = createPersonSettingsRoutes({
    store,
    principal: () => principal,
    saved: (_id, before, after) => saved.push(before.browserProfiles.map((p) => p.id).filter((id) => !after.browserProfiles.some((q) => q.id === id))),
  });
  const call = async (method: string, body?: unknown) => {
    let answer: { status: number; body: unknown } = { status: 0, body: null };
    await route({
      req: {} as never, res: { setHeader() {} } as never, path: PERSON_SETTINGS_PATH, method, auth: {} as never,
      json: (_res: unknown, status: number, value: unknown) => { answer = { status, body: value }; },
      readBody: async () => body,
    } as never);
    return answer as { status: number; body: { features: Record<string, boolean>; browserProfiles: Array<{ id: string; name: string }>; error?: string } };
  };
  return { store, call, saved };
}

describe("a person's own Experimental settings (#1098)", () => {
  it("sets the person's own switches and browser profiles, with no installation right", async () => {
    const { call, saved } = setup();
    expect((await call("PATCH", { features: { skillAuthoring: true, dataWindow: false } })).body.features).toEqual({ skillAuthoring: true, dataWindow: false });
    // the shared server's switches are not the person's
    expect((await call("PATCH", { features: { browser: true } })).status).toBe(400);
    const created = await call("PATCH", { browserProfiles: [{ name: "Bank" }] });
    const id = created.body.browserProfiles[0]!.id;
    expect(id).toMatch(/^mine-[0-9a-f]{32}$/);
    // an id the person does not own is refused
    expect((await call("PATCH", { browserProfiles: [{ id: "mine-ffffffffffffffffffffffffffffffff", name: "X" }] })).status).toBe(409);
    expect((await call("PATCH", { browserProfiles: [] })).body.browserProfiles).toEqual([]);
    expect(saved.at(-1)).toEqual([id]);
    expect((await call("PATCH", { features: { skillAuthoring: null } })).body.features).toEqual({ dataWindow: false });
  });

  it("keeps Show tool calls as the person's own display choice (#1098, 2026-10-28)", async () => {
    const { call } = setup();
    expect((await call("PATCH", { features: { showToolCalls: true } })).body.features).toEqual({ showToolCalls: true });
    expect((await setup("sam").call("GET")).body.features).toEqual({});
  });

  it("keeps each person's profile storage apart, and answers 404 without a person", async () => {
    expect(personalProfilePartition("alex", "mine-a")).not.toBe(personalProfilePartition("sam", "mine-a"));
    expect((await setup(null).call("GET")).status).toBe(404);
  });
});
