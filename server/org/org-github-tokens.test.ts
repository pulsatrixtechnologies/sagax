import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MAX_ORG_GITHUB_TOKENS, orgGithubTokenHint } from "../../shared/org-github-tokens.ts";
import { OrgGithubTokens, OrgGithubTokensError, parseOrgGithubTokenChange } from "./org-github-tokens.ts";

const ALPHA = "fake-alpha-token-1111";
const BRAVO = "fake-bravo-token-2222";
const CHARLIE = "fake-charlie-token-3333";
const CHARLIE_NEXT = "fake-charlie-token-4444";
const SECRETS = [ALPHA, BRAVO, CHARLIE, CHARLIE_NEXT];

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const key = { kind: "key" as const, key: Buffer.alloc(32, 4) };

function open() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-org-gh-"));
  dirs.push(dir);
  return { dir, store: new OrgGithubTokens(dir, () => key), file: join(dir, "org-github-tokens.enc") };
}

function assertRedacted(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) expect(text.includes(secret)).toBe(false);
}

describe("org github access tokens", () => {
  it("redacts a hint to the last 4, or the saved word when that would be the value", () => {
    expect(orgGithubTokenHint(ALPHA)).toBe("1111");
    expect(orgGithubTokenHint("short")).toBe("saved");
    expect(orgGithubTokenHint("12345678")).toBe("5678");
  });

  it("adds, lists redacted, and keeps the others when one of several is removed", () => {
    const { store, file, dir } = open();
    store.change({ op: "add", label: "Alpha org", token: ALPHA });
    store.change({ op: "add", label: "Bravo org", token: BRAVO });
    const listed = store.change({ op: "add", label: "Charlie org", token: CHARLIE });
    expect(listed.map((entry) => ({ label: entry.label, hint: entry.hint }))).toEqual([
      { label: "Alpha org", hint: "1111" },
      { label: "Bravo org", hint: "2222" },
      { label: "Charlie org", hint: "3333" },
    ]);
    assertRedacted(listed);
    expect(listed.every((entry) => Object.keys(entry).sort().join() === "hint,id,label")).toBe(true);
    const [alpha, bravo, charlie] = listed;
    expect(store.tokenFor(alpha!.id)).toBe(ALPHA);
    expect(store.tokenFor(bravo!.id)).toBe(BRAVO);

    const cipher = readFileSync(file);
    expect(cipher.includes(Buffer.from(ALPHA))).toBe(false);
    expect(cipher.includes(Buffer.from(BRAVO))).toBe(false);
    expect(cipher.includes(Buffer.from(CHARLIE))).toBe(false);
    const envelope = JSON.parse(cipher.toString("utf8")) as { v: number; data: string };
    expect(envelope.v).toBe(1);
    expect(Buffer.from(envelope.data, "base64").includes(Buffer.from(ALPHA))).toBe(false);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);

    const kept = store.change({ op: "remove", id: bravo!.id });
    expect(kept.map((entry) => entry.label)).toEqual(["Alpha org", "Charlie org"]);
    expect(kept.map((entry) => entry.id)).toEqual([alpha!.id, charlie!.id]);
    expect(store.tokenFor(alpha!.id)).toBe(ALPHA);
    expect(store.tokenFor(charlie!.id)).toBe(CHARLIE);
    expect(store.tokenFor(bravo!.id)).toBeUndefined();
    assertRedacted(kept);

    const again = new OrgGithubTokens(dir, () => key);
    expect(again.list()).toEqual(kept);
    assertRedacted(again.list());
  });

  it("renames without changing the secret, and replaces only that secret when asked", () => {
    const { store } = open();
    store.change({ op: "add", label: "Alpha org", token: ALPHA });
    const listed = store.change({ op: "add", label: "Charlie org", token: CHARLIE });
    const alpha = listed[0]!;
    const charlie = listed[1]!;
    expect(() => parseOrgGithubTokenChange({ op: "rename", id: alpha.id, label: "Alpha renamed", token: ALPHA })).toThrow(OrgGithubTokensError);
    const renamed = store.change({ op: "rename", id: alpha.id, label: "Alpha renamed" });
    expect(renamed.find((entry) => entry.id === alpha.id)).toMatchObject({ label: "Alpha renamed", hint: "1111" });
    expect(store.tokenFor(alpha.id)).toBe(ALPHA);
    expect(store.tokenFor(charlie.id)).toBe(CHARLIE);
    assertRedacted(renamed);

    const replaced = store.change({ op: "replace", id: charlie.id, token: CHARLIE_NEXT });
    expect(replaced.find((entry) => entry.id === charlie.id)).toMatchObject({ label: "Charlie org", hint: "4444" });
    expect(store.tokenFor(charlie.id)).toBe(CHARLIE_NEXT);
    expect(store.tokenFor(alpha.id)).toBe(ALPHA);
    assertRedacted(replaced);
  });

  it("stops at the limit and leaves the saved tokens in place", () => {
    const { store } = open();
    const secrets: string[] = [];
    for (let index = 0; index < MAX_ORG_GITHUB_TOKENS; index += 1) {
      const secret = `fake-group-token-${String(index).padStart(4, "0")}`;
      secrets.push(secret);
      store.change({ op: "add", label: `Group ${index}`, token: secret });
    }
    expect(store.list()).toHaveLength(MAX_ORG_GITHUB_TOKENS);
    expect(() => store.change({ op: "add", label: "One more", token: "fake-group-token-9999" })).toThrow(OrgGithubTokensError);
    const listed = store.list();
    expect(listed).toHaveLength(MAX_ORG_GITHUB_TOKENS);
    expect(JSON.stringify(listed).includes("fake-group-token-")).toBe(false);
    expect(store.tokenFor(listed[0]!.id)).toBe(secrets[0]);
    expect(store.tokenFor(listed[19]!.id)).toBe(secrets[19]);
  });

  it("does not overwrite a list it cannot read", () => {
    const { dir, file } = open();
    const first = new OrgGithubTokens(dir, () => key);
    first.change({ op: "add", label: "Alpha org", token: ALPHA });
    const before = readFileSync(file);
    const locked = new OrgGithubTokens(dir, () => ({ kind: "unavailable", reason: "The encrypted credential store could not be read on this launch." }));
    expect(() => locked.list()).toThrow(OrgGithubTokensError);
    expect(() => locked.change({ op: "remove", id: "gt_0123456789abcdef" })).toThrow(OrgGithubTokensError);
    expect(readFileSync(file).equals(before)).toBe(true);

    writeFileSync(file, "not-a-vault");
    const broken = new OrgGithubTokens(dir, () => key);
    expect(() => broken.list()).toThrow(/could not be read/);
    expect(() => broken.change({ op: "add", label: "Alpha org", token: ALPHA })).toThrow(OrgGithubTokensError);
    expect(readFileSync(file, "utf8")).toBe("not-a-vault");
  });

  it("reads its tokens once the vault key arrives after a start without it, never staying locked for the launch (#4155)", () => {
    const { dir } = open();
    new OrgGithubTokens(dir, () => key).change({ op: "add", label: "Alpha org", token: ALPHA });
    let source: { kind: "unavailable"; reason: string } | typeof key = { kind: "unavailable", reason: "The encrypted credential store could not be read on this launch." };
    const later = new OrgGithubTokens(dir, () => source);
    expect(() => later.list()).toThrow(OrgGithubTokensError);
    source = key;
    const listed = later.list();
    expect(listed).toHaveLength(1);
    expect(later.tokenFor(listed[0]!.id)).toBe(ALPHA);
  });

  it("refuses a label that holds the secret and a change that mixes rename with a secret", () => {
    const { store, file } = open();
    store.change({ op: "add", label: "Alpha org", token: ALPHA });
    const before = readFileSync(file);
    expect(() => store.change({ op: "add", label: ALPHA, token: ALPHA })).toThrow(OrgGithubTokensError);
    expect(() => store.change({ op: "rename", id: store.list()[0]!.id, label: `prefix ${ALPHA}` })).toThrow(OrgGithubTokensError);
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(store.list()).toEqual([expect.objectContaining({ label: "Alpha org", hint: "1111" })]);
    assertRedacted(store.list());
  });

  it("deletes the file when the last token is removed", () => {
    const { store, file } = open();
    const [only] = store.change({ op: "add", label: "Alpha org", token: ALPHA });
    expect(store.change({ op: "remove", id: only!.id })).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });
});
