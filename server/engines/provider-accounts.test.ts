import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProviderAccountsFailureLog, nothingToSyncYet, ProviderAccounts, ProviderAccountsError, providerAccountsFailureLine } from "./provider-accounts.ts";
import { ProviderKeysStore, PROVIDER_KEYS_FILE } from "./provider-keys.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "sagax-accounts-")); dirs.push(dataDir);
  const store = new ProviderKeysStore(dataDir, () => ({ kind: "key", key: Buffer.alloc(32, 3) }));
  const saved = new Map<string, Map<string, string>>();
  let refuse = false;
  const directory = {
    invalidate: vi.fn(), rememberProviderKeys: vi.fn(), resolveProviderKey: vi.fn(),
    linkPostJson: vi.fn(async (_path: string, input: unknown) => {
      const body = input as { sub: string; provider?: string; value?: string | null; import?: boolean };
      const keys = saved.get(body.sub) ?? new Map<string, string>(); saved.set(body.sub, keys);
      if (_path.endsWith("/save") && body.provider) {
        if (refuse) return { ok: false as const, error: "unreachable" as const };
        if (body.value === null) keys.delete(body.provider);
        else if (!body.import || !keys.has(body.provider)) keys.set(body.provider, body.value!);
        return { ok: true as const, status: 200, body: { provider: body.provider, configured: keys.has(body.provider) } };
      }
      return { ok: true as const, status: 200, body: { keys: [...keys].map(([provider, key]) => ({ provider, last4: key.slice(-4) })), servers: [] } };
    }),
  };
  return { dataDir, store, directory, saved, refuse: () => { refuse = true; }, accounts: new ProviderAccounts({ dataDir, store, directory }) };
}

describe("personal provider accounts", () => {
  it("keeps solo keys and compatible servers together without returning secrets", async () => {
    const { accounts } = fixture();
    const server = { instanceId: "lab-api", name: "Lab", url: "http://127.0.0.1:9000/v1", protocol: "openai" as const, models: [{ id: "vendor/model", label: "Model" }] };
    await accounts.setServer(undefined, server.instanceId, server);
    const view = await accounts.setKey(undefined, "compat:lab-api", "lab-provider-secret");
    expect(view).toEqual({ keys: [{ provider: "compat:lab-api", last4: "cret" }], servers: [server] });
    expect(JSON.stringify(view)).not.toContain("lab-provider-secret");
    expect(await accounts.key(undefined, "compat:lab-api")).toBe("lab-provider-secret");
    expect(await accounts.setServer(undefined, server.instanceId, null)).toEqual({ keys: [], servers: [] });
  });

  it("imports before deleting the local source, preserves an existing remote key and cannot resurrect a deleted one", async () => {
    const { accounts, store, saved, dataDir, directory } = fixture();
    const owner = { principalId: "person-a", sub: "subject-a" };
    store.set(owner, "openai", "lab-legacy-secret");
    saved.set(owner.sub, new Map([["openai", "lab-current-secret"]]));
    expect((await accounts.list(owner)).keys).toEqual([{ provider: "openai", last4: "cret" }]);
    expect(saved.get(owner.sub)?.get("openai")).toBe("lab-current-secret");
    expect(existsSync(join(dataDir, "principals", owner.principalId, PROVIDER_KEYS_FILE))).toBe(false);
    await accounts.setKey(owner, "openai", null);
    expect((await accounts.list(owner)).keys).toEqual([]);
    expect(directory.rememberProviderKeys).toHaveBeenLastCalledWith(owner.sub, []);
    expect((await accounts.list({ principalId: "person-b", sub: "subject-b" })).keys).toEqual([]);
  });

  it("retains the source on refused import and serializes a concurrent clear after that import", async () => {
    const broken = fixture();
    const owner = { principalId: "person-a", sub: "subject-a" };
    broken.store.set(owner, "fish", "lab-fish-secret");
    broken.refuse();
    await expect(broken.accounts.list(owner)).rejects.toThrow("could not be saved");
    expect(broken.store.keys(owner).fish).toBe("lab-fish-secret");
    const { accounts, store } = fixture();
    store.set(owner, "fish", "lab-fish-secret");
    const [, cleared] = await Promise.all([accounts.list(owner), accounts.setKey(owner, "fish", null)]);
    expect(cleared.keys).toEqual([]);
    expect((await accounts.list(owner)).keys).toEqual([]);
  });
});

it.each([404, 405])("names an older organization host (%s), preserves local imports and resolves existing keys", async (status) => {
  const { accounts, directory, store, dataDir } = fixture();
  const owner = { principalId: "person-a", sub: "subject-a" };
  store.set(owner, "openai", "fixture-pending-import");
  directory.linkPostJson.mockResolvedValue({ ok: false, error: "refused", status } as never);
  await expect(accounts.list(owner)).rejects.toMatchObject({ status: 409, code: "provider_accounts_update_required" });
  expect(existsSync(join(dataDir, "principals", owner.principalId, PROVIDER_KEYS_FILE))).toBe(true);
  directory.resolveProviderKey.mockResolvedValue({ ok: true, key: "fixture-existing-remote", fingerprint: "remote" });
  expect(await accounts.key(owner, "openai")).toBe("fixture-existing-remote");
  directory.resolveProviderKey.mockResolvedValue({ ok: false, error: "no_key" });
  expect(await accounts.key(owner, "openai")).toBe("fixture-pending-import");
  expect(store.keys(owner).openai).toBe("fixture-pending-import");
  for (const error of ["user_inactive", "link"]) {
    directory.resolveProviderKey.mockResolvedValue({ ok: false, error });
    expect(await accounts.key(owner, "openai")).toBeUndefined();
  }
});

describe("the repeating provider-accounts failure (#3519)", () => {
  const owner = { principalId: "person-a", sub: "subject-a" };

  it("reads past a kind of provider or a server this server does not know, instead of refusing the whole list", async () => {
    const { accounts, directory } = fixture();
    directory.linkPostJson.mockResolvedValue({ ok: true, status: 200, body: {
      keys: [{ provider: "openai", last4: "abcd" }, { provider: "provider-from-the-future", last4: "wxyz" }],
      servers: [{ instanceId: "lab", name: "Lab", url: "http://127.0.0.1:9000/v1", protocol: "openai", models: [] }, { instanceId: "odd", protocol: "carrier-pigeon" }],
    } } as never);
    const view = await accounts.list(owner);
    expect(view.keys).toEqual([{ provider: "openai", last4: "abcd" }]);
    expect(view.servers.map((server) => server.instanceId)).toEqual(["lab"]);
    expect(directory.rememberProviderKeys).toHaveBeenLastCalledWith(owner.sub, ["openai"]);
  });

  it("imports the keys it knows and keeps a key of an unknown kind where it is, without failing every later call", async () => {
    const { accounts, store, saved, dataDir } = fixture();
    store.set(owner, "openai", "lab-openai-secret");
    store.set(owner, "provider-from-the-future", "lab-future-secret");
    await expect(accounts.list(owner)).resolves.toMatchObject({ keys: [{ provider: "openai" }] });
    expect(saved.get(owner.sub)?.get("openai")).toBe("lab-openai-secret");
    expect(store.keys(owner)).toEqual({ "provider-from-the-future": "lab-future-secret" });
    // the next poll neither fails nor imports again
    await expect(accounts.list(owner)).resolves.toMatchObject({ keys: [{ provider: "openai" }] });
    expect(existsSync(join(dataDir, "principals", owner.principalId, PROVIDER_KEYS_FILE))).toBe(true);
  });

  it("keeps a key the organization server refuses as unknown (400) here and imports the others", async () => {
    const { accounts, store, saved, directory } = fixture();
    const answer = directory.linkPostJson.getMockImplementation()!;
    directory.linkPostJson.mockImplementation((async (path: string, input: unknown) => {
      if ((input as { provider?: string }).provider === "deepseek") return { ok: false as const, error: "refused" as const, status: 400, body: { error: "unknown provider" } };
      return answer(path, input);
    }) as never);
    store.set(owner, "deepseek", "lab-deepseek-secret");
    store.set(owner, "openai", "lab-openai-secret");
    await expect(accounts.list(owner)).resolves.toMatchObject({ keys: [{ provider: "openai" }] });
    expect(saved.get(owner.sub)?.get("openai")).toBe("lab-openai-secret");
    expect(store.keys(owner)).toEqual({ deepseek: "lab-deepseek-secret" });
    // the next poll neither fails nor asks the organization server again
    const calls = directory.linkPostJson.mock.calls.length;
    await expect(accounts.list(owner)).resolves.toMatchObject({ keys: [{ provider: "openai" }] });
    expect(directory.linkPostJson.mock.calls.slice(calls).map(([path]) => path)).toEqual(["/api/v1/pulsabot/provider-keys/list"]);
  });

  it("treats no sign-in token for the person (403 subject) as nothing to sync yet, not a failure", async () => {
    const { accounts, directory } = fixture();
    directory.linkPostJson.mockResolvedValue({ ok: false, error: "refused", status: 403, body: { code: "subject" } } as never);
    const error = await accounts.list(owner).catch((failure: unknown) => failure);
    expect(nothingToSyncYet(error)).toBe(true);
    const lines: string[] = [];
    const log = createProviderAccountsFailureLog((line) => lines.push(line));
    await log.run(owner.principalId, () => accounts.list(owner).then(() => undefined));
    expect(lines).toEqual([]);
    directory.linkPostJson.mockResolvedValue({ ok: false, error: "refused", status: 403, body: { code: "forbidden" } } as never);
    await log.run(owner.principalId, () => accounts.list(owner).then(() => undefined));
    expect(lines).toEqual(["provider accounts: the list step failed (organization server: HTTP 403)"]);
  });

  it("names the step, the kind of provider and the answer in its log line, never a key or the person", async () => {
    const { accounts, store, directory } = fixture();
    store.set(owner, "fish", "lab-fish-secret");
    directory.linkPostJson.mockResolvedValue({ ok: false, error: "link", status: 403 } as never);
    const error = await accounts.list(owner).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ProviderAccountsError);
    expect((error as Error).message).toBe("Your provider accounts could not be saved. Try again.");
    const line = providerAccountsFailureLine(error);
    expect(line).toBe("provider accounts: the import step failed (provider fish, organization server: HTTP 403)");
    for (const secret of ["lab-fish-secret", owner.sub, owner.principalId]) expect(line).not.toContain(secret);
    const listed = fixture();
    listed.directory.linkPostJson.mockResolvedValue({ ok: false, error: "unreachable" } as never);
    expect(providerAccountsFailureLine(await listed.accounts.list(owner).catch((failure: unknown) => failure)))
      .toBe("provider accounts: the list step failed (organization server: unreachable)");
  });

  it("logs a person's same failure once per cause, again after it worked", () => {
    const lines: string[] = [];
    const log = createProviderAccountsFailureLog((line) => lines.push(line));
    const refused = Object.assign(new ProviderAccountsError(403), { step: "list" as const, upstream: "HTTP 403" });
    log.failed("person-a", refused);
    log.failed("person-a", refused);
    log.failed("person-a", refused);
    expect(lines).toEqual(["provider accounts: the list step failed (organization server: HTTP 403)"]);
    log.worked("person-a");
    log.failed("person-a", refused);
    expect(lines).toHaveLength(2);
  });
});
