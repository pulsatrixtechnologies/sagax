import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAccountEmail, isPrincipalId, mergePrincipalFiles, PrincipalRegistry } from "./principals.ts";

function registry() {
  const dir = mkdtempSync(join(tmpdir(), "principals-"));
  let n = 0;
  const path = join(dir, "principals.json");
  return { path, reg: new PrincipalRegistry({ path, now: () => 1000, newId: () => `pr_00000000-0000-4000-8000-00000000000${n++}` }) };
}

describe("principal registry", () => {
  it("keeps the person's own avatar version set from Sagax, clears it with null, and ignores a malformed one", () => {
    const { path, reg } = registry();
    const a = reg.forSubject({ iss: "https://px.example", sub: "u1", claims: { name: "Ada" } });
    expect(reg.setAvatar(a.id, "0123456789abcdef")?.avatar).toBe("0123456789abcdef");
    expect(reg.setAvatar(a.id, "not a version!")?.avatar).toBe("0123456789abcdef");
    expect(reg.setAvatar("pr_00000000-0000-4000-8000-0000000000ff", "abc")).toBeNull();
    const again = new PrincipalRegistry({ path, now: () => 2000, newId: () => "unused" });
    expect(again.byId(a.id)?.avatar).toBe("0123456789abcdef");
    expect(again.setAvatar(a.id, null)?.avatar).toBeUndefined();
    expect(JSON.parse(readFileSync(path, "utf8")).principals[0]).not.toHaveProperty("avatar");
  });

  it("keeps a person's label across a restart, clears it with null, and reads a malformed one as absent", () => {
    const { path, reg } = registry();
    const a = reg.forSubject({ iss: "https://px.example", sub: "u1", claims: { name: "Ada" } });
    expect(a.label).toBeUndefined();
    expect(reg.setLabel(a.id, "CTO")?.label).toBe("CTO");
    expect(reg.setLabel("pr_00000000-0000-4000-8000-0000000000ff", "x")).toBeNull();
    const again = new PrincipalRegistry({ path, now: () => 2000, newId: () => "unused" });
    expect(again.byId(a.id)?.label).toBe("CTO");
    expect(again.setLabel(a.id, null)?.label).toBeUndefined();
    expect(JSON.parse(readFileSync(path, "utf8")).principals[0]).not.toHaveProperty("label");
    const file = JSON.parse(readFileSync(path, "utf8"));
    file.principals[0].label = 42;
    writeFileSync(path, JSON.stringify(file));
    const tolerant = new PrincipalRegistry({ path, now: () => 3000, newId: () => "unused" });
    expect(tolerant.byId(a.id)).toMatchObject({ id: a.id, name: "Ada" });
    expect(tolerant.byId(a.id)?.label).toBeUndefined();
  });

  it("creates one principal per account and finds it again", () => {
    const { reg } = registry();
    const a = reg.forAccount({ email: "Morgan@Example.com", controlPlaneUserId: "cp_1" });
    expect(a).toMatchObject({ kind: "human", email: "morgan@example.com", controlPlaneUserId: "cp_1" });
    expect(reg.forAccount({ email: "morgan@example.com", controlPlaneUserId: "cp_1" }).id).toBe(a.id);
    expect(reg.list()).toHaveLength(1);
  });

  it("keeps the principal when the account email changes", () => {
    const { reg } = registry();
    const a = reg.forAccount({ email: "old@example.com", controlPlaneUserId: "cp_1" });
    const b = reg.forAccount({ email: "new@example.com", controlPlaneUserId: "cp_1" });
    expect(b.id).toBe(a.id);
    expect(b.email).toBe("new@example.com");
    expect(reg.byEmail("old@example.com")).toBeNull();
  });

  it("links an email-only principal to its account on first sign-in", () => {
    const { reg } = registry();
    const a = reg.forAccount({ email: "morgan@example.com" });
    const b = reg.forAccount({ email: "morgan@example.com", controlPlaneUserId: "cp_9" });
    expect(b.id).toBe(a.id);
    expect(b.controlPlaneUserId).toBe("cp_9");
  });

  it("has exactly one local operator and gives it the profile email", () => {
    const { reg } = registry();
    const a = reg.localOperator();
    const b = reg.localOperator("owner@example.com");
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ local: true, email: "owner@example.com" });
    expect(reg.list().filter((p) => p.local)).toHaveLength(1);
  });

  it("persists across instances", () => {
    const { path, reg } = registry();
    const a = reg.forAccount({ email: "morgan@example.com", controlPlaneUserId: "cp_1" });
    const again = new PrincipalRegistry({ path });
    expect(again.byId(a.id)).toMatchObject({ email: "morgan@example.com" });
    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(1);
  });

  it("recognizes principal ids", () => {
    expect(isPrincipalId("pr_00000000-0000-4000-8000-000000000000")).toBe(true);
    expect(isPrincipalId("morgan@example.com")).toBe(false);
    expect(isPrincipalId("local-owner")).toBe(false);
  });

  it("moves an unparseable principals.json aside and starts empty without overwriting it", () => {
    const dir = mkdtempSync(join(tmpdir(), "principals-"));
    const path = join(dir, "principals.json");
    writeFileSync(path, "{invalid json");
    const reg = new PrincipalRegistry({ path, now: () => 42 });
    expect(reg.list()).toHaveLength(0);
    expect(readFileSync(join(dir, "principals.json.corrupt-42"), "utf8")).toBe("{invalid json");
    reg.localOperator();
    expect(readdirSync(dir).sort()).toEqual(["principals.json", "principals.json.corrupt-42"]);
  });

  it("skips an oversized or malformed entry and keeps the local operator across a restart", () => {
    const { path, reg } = registry();
    const local = reg.localOperator("owner@example.com");
    const morgan = reg.forAccount({ email: "morgan@example.com" });
    const file = JSON.parse(readFileSync(path, "utf8"));
    file.principals.push(
      { id: "pr_00000000-0000-4000-8000-0000000000ff", kind: "human", email: `${"a".repeat(400)}@example.com`, createdAt: 1 },
      { id: "not-a-principal", kind: "human", createdAt: 1 },
      { id: "pr_00000000-0000-4000-8000-0000000000fe", kind: "human", local: true, createdAt: 1 },
    );
    writeFileSync(path, JSON.stringify(file));
    const again = new PrincipalRegistry({ path, now: () => 7 });
    expect(again.local()?.id).toBe(local.id);
    expect(again.localOperator("owner@example.com").id).toBe(local.id);
    expect(again.byId(morgan.id)).toMatchObject({ email: "morgan@example.com" });
    expect(again.list()).toHaveLength(2);
    // The original is kept beside the rewritten file.
    expect(existsSync(`${path}.corrupt-7`)).toBe(true);
    expect(new PrincipalRegistry({ path }).local()?.id).toBe(local.id);
  });

  it("refuses an account email over 320 characters or without local@domain", () => {
    const { reg } = registry();
    expect(() => reg.forAccount({ email: `${"a".repeat(400)}@example.com` })).toThrow(/account email/);
    expect(() => reg.forAccount({ email: "not-an-email" })).toThrow(/account email/);
    expect(() => reg.forAccount({ email: "@example.com" })).toThrow(/account email/);
    expect(reg.list()).toHaveLength(0);
    expect(isAccountEmail("morgan@example.com")).toBe(true);
    expect(isAccountEmail(`${"a".repeat(320)}@example.com`)).toBe(false);
  });

  it("reads the local operator without writing", () => {
    const { path, reg } = registry();
    expect(reg.local()).toBeNull();
    expect(existsSync(path)).toBe(false);
    const local = reg.localOperator();
    expect(reg.local()?.id).toBe(local.id);
  });

  it("merges a restored file by id without replacing the local operator", () => {
    const mine = { id: "pr_00000000-0000-4000-8000-000000000001", kind: "human", local: true, createdAt: 1 };
    const shared = { id: "pr_00000000-0000-4000-8000-000000000002", kind: "human", email: "morgan@example.com", createdAt: 1 };
    const theirs = { id: "pr_00000000-0000-4000-8000-000000000003", kind: "human", local: true, email: "old@example.com", createdAt: 1 };
    const merged = mergePrincipalFiles(
      { version: 1, principals: [mine, shared] },
      { version: 1, principals: [{ ...shared, email: "changed@example.com" }, theirs] },
    );
    expect(merged.principals).toEqual([mine, shared, { id: theirs.id, kind: "human", email: "old@example.com", createdAt: 1 }]);
    expect(mergePrincipalFiles(undefined, { version: 1, principals: [theirs] }).principals).toEqual([theirs]);
  });

  it("creates parent directories for a nested path", () => {
    const dir = mkdtempSync(join(tmpdir(), "principals-"));
    const nestedPath = join(dir, "subdir", "deep", "principals.json");
    const reg = new PrincipalRegistry({ path: nestedPath, now: () => 1000, newId: () => "pr_00000000-0000-4000-8000-000000000000" });
    reg.forAccount({ email: "test@example.com" });
    expect(existsSync(nestedPath)).toBe(true);
  });
});

describe("principals from an identity provider (forSubject)", () => {
  const ISS = "https://px.example.test";
  it("keys a person by (iss, sub) and keeps name, login, email and role as attributes", () => {
    const { reg, path } = registry();
    const a = reg.forSubject({ iss: ISS, sub: "01JSUBJECT", claims: { email: "Ada@Example.test", name: "Ada", login: "ada" }, orgRole: "admin" });
    expect(a).toMatchObject({ kind: "human", subject: { iss: ISS, sub: "01JSUBJECT" }, email: "ada@example.test", name: "Ada", login: "ada", orgRole: "admin" });
    const b = reg.forSubject({ iss: ISS, sub: "01JSUBJECT", claims: { email: "ada.new@example.test", name: "Ada L." }, orgRole: "member" });
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ email: "ada.new@example.test", name: "Ada L.", orgRole: "member" });
    expect(b.login).toBeUndefined();
    expect(JSON.parse(readFileSync(path, "utf8")).principals).toHaveLength(1);
    // another issuer with the same sub is another person
    expect(reg.forSubject({ iss: "https://other.example.test", sub: "01JSUBJECT", claims: {} }).id).not.toBe(a.id);
    expect(reg.bySubject(ISS, "01JSUBJECT")?.id).toBe(a.id);
  });

  it("never matches or merges people by email, in either direction", () => {
    const { reg } = registry();
    const interim = reg.forAccount({ email: "sam@example.test" });
    const oidc = reg.forSubject({ iss: ISS, sub: "01JSAM", claims: { email: "sam@example.test" } });
    expect(oidc.id).not.toBe(interim.id);
    const other = reg.forSubject({ iss: ISS, sub: "01JMALLORY", claims: { email: "ada@example.test" } });
    // an email sign-in with the subject person's address does not claim them
    expect(reg.forAccount({ email: "ada@example.test" }).id).not.toBe(other.id);
  });

  it("drops an address that is not an account email, and survives a reload", () => {
    const { reg, path } = registry();
    const a = reg.forSubject({ iss: ISS, sub: "01JX", claims: { email: "not an email" } });
    expect(a.email).toBeUndefined();
    const again = new PrincipalRegistry({ path });
    expect(again.bySubject(ISS, "01JX")?.id).toBe(a.id);
    expect(() => reg.forSubject({ iss: ISS, sub: "" })).toThrow();
  });
});

describe("a person the identity provider signalled out", () => {
  it("is marked disabled by subject, and a later sign-in or refresh clears it", () => {
    const { reg, path } = registry();
    const p = reg.forSubject({ iss: "https://px.example.test", sub: "S1", orgRole: "member" });
    expect(reg.markDisabled("https://px.example.test", "unknown", 5)).toBeNull();
    expect(reg.markDisabled("https://px.example.test", "S1", 5)).toMatchObject({ id: p.id, disabledAt: 5 });
    expect(reg.byId(p.id)?.disabledAt).toBe(5);
    expect(JSON.parse(readFileSync(path, "utf8")).principals[0].disabledAt).toBe(5);
    const back = reg.forSubject({ iss: "https://px.example.test", sub: "S1", orgRole: "member" });
    expect(back.id).toBe(p.id);
    expect(back.disabledAt).toBeUndefined();
    expect(JSON.parse(readFileSync(path, "utf8")).principals[0].disabledAt).toBeUndefined();
  });
});

describe("principals from the Perspicax directory (upsertFromDirectory)", () => {
  const ISS = "https://px.example.test";
  it("creates a person who never signed in, and their sign-in lands on the same principal", () => {
    const { reg } = registry();
    const listed = reg.upsertFromDirectory({ iss: ISS, sub: "01JBOB", name: "Bob", login: "bob", email: "Bob@Example.test", orgRole: "member" });
    expect(listed).toMatchObject({ kind: "human", subject: { iss: ISS, sub: "01JBOB" }, name: "Bob", login: "bob", email: "bob@example.test", orgRole: "member" });
    const signedIn = reg.forSubject({ iss: ISS, sub: "01JBOB", claims: { email: "bob@example.test", name: "Bob" }, orgRole: "member" });
    expect(signedIn.id).toBe(listed.id);
  });

  it("updates attributes and role, and never clears disabledAt", () => {
    const { reg } = registry();
    const p = reg.forSubject({ iss: ISS, sub: "S2", claims: { name: "Old" }, orgRole: "admin" });
    reg.markDisabled(ISS, "S2", 7);
    const next = reg.upsertFromDirectory({ iss: ISS, sub: "S2", name: "New", login: "s2", email: null, orgRole: "member" });
    expect(next).toMatchObject({ id: p.id, name: "New", login: "s2", orgRole: "member", disabledAt: 7 });
    expect(next.email).toBeUndefined();
  });

  it("lists the people of one issuer only", () => {
    const { reg } = registry();
    reg.upsertFromDirectory({ iss: ISS, sub: "A", orgRole: "member" });
    reg.upsertFromDirectory({ iss: "https://other.example.test", sub: "B", orgRole: "member" });
    reg.localOperator();
    expect(reg.listBySubjectIssuer(ISS).map((p) => p.subject?.sub)).toEqual(["A"]);
    expect(() => reg.upsertFromDirectory({ iss: ISS, sub: " ", orgRole: "member" })).toThrow();
  });
});

describe("a person's Perspicax avatar version", () => {
  const ISS = "https://px.example.test";
  it("is set by a picture claim, kept when a token has none, and removed only by the directory", () => {
    const { path, reg } = registry();
    const p = reg.forSubject({ iss: ISS, sub: "AV", claims: { name: "Ava", avatar: "a1b2c3" }, orgRole: "member" });
    expect(p.avatar).toBe("a1b2c3");
    // a refreshed id_token without picture says nothing about the avatar
    expect(reg.forSubject({ iss: ISS, sub: "AV", claims: { name: "Ava" }, orgRole: "member" }).avatar).toBe("a1b2c3");
    // an older Perspicax directory (no field) leaves it
    expect(reg.upsertFromDirectory({ iss: ISS, sub: "AV", name: "Ava", orgRole: "member" }).avatar).toBe("a1b2c3");
    // a new version from the directory replaces it; null removes it
    expect(reg.upsertFromDirectory({ iss: ISS, sub: "AV", name: "Ava", avatar: "d4e5f6", orgRole: "member" }).avatar).toBe("d4e5f6");
    expect(JSON.parse(readFileSync(path, "utf8")).principals.find((x: { id: string }) => x.id === p.id).avatar).toBe("d4e5f6");
    expect(reg.upsertFromDirectory({ iss: ISS, sub: "AV", name: "Ava", avatar: null, orgRole: "member" }).avatar).toBeUndefined();
    // a value that is not a version is never stored
    expect(reg.forSubject({ iss: ISS, sub: "AV", claims: { avatar: "../../x?y" }, orgRole: "member" }).avatar).toBeUndefined();
  });
});

describe("slice 4: teams and the Perspicax role", () => {
  it("a sign-in sets teams and role; an absent claim leaves the teams alone; a change calls the listener", () => {
    const { reg, path } = registry();
    const changed: string[] = [];
    reg.onAccessChanged((id) => changed.push(id));
    const carol = reg.forSubject({ iss: "https://px", sub: "C", orgRole: "member", perspicaxRole: "employee", teams: [{ id: "T2", manager: false }, { id: "T1", manager: false }, { id: "T1", manager: true }, { id: "bad id", manager: true }] });
    expect(carol).toMatchObject({ perspicaxRole: "employee", teams: [{ id: "T1", manager: true }, { id: "T2", manager: false }] });
    expect(changed).toEqual([]); // a new person has nothing to recompute
    expect(reg.forSubject({ iss: "https://px", sub: "C", orgRole: "member" }).teams).toHaveLength(2);
    expect(changed).toEqual([]);
    reg.forSubject({ iss: "https://px", sub: "C", orgRole: "member", teams: [] });
    expect(reg.byId(carol.id)?.teams).toBeUndefined();
    expect(changed).toEqual([carol.id]);
    expect(JSON.parse(readFileSync(path, "utf8")).principals[0].perspicaxRole).toBe("employee");
  });

  it("the directory, setTeams and membersOfTeam", () => {
    const { reg } = registry();
    const changed: string[] = [];
    reg.onAccessChanged((id) => changed.push(id));
    const mia = reg.upsertFromDirectory({ iss: "https://px", sub: "M", orgRole: "member", perspicaxRole: "manager", teams: [{ id: "T", manager: true }] });
    const dave = reg.upsertFromDirectory({ iss: "https://px", sub: "D", orgRole: "member", teams: [{ id: "U", manager: false }] });
    expect(reg.membersOfTeam("T").map((p) => p.id)).toEqual([mia.id]);
    expect(reg.setTeams(dave.id, [{ id: "T", manager: false }])?.teams).toEqual([{ id: "T", manager: false }]);
    expect(changed).toEqual([dave.id]);
    expect(reg.membersOfTeam("T").map((p) => p.id).sort()).toEqual([mia.id, dave.id].sort());
    expect(reg.setTeams("pr_nobody", [])).toBeNull();
    // the same teams again change nothing
    reg.upsertFromDirectory({ iss: "https://px", sub: "D", orgRole: "member", teams: [{ id: "T", manager: false }] });
    expect(changed).toEqual([dave.id]);
  });
});

describe("interim people (slice 8)", () => {
  it("lists people from before Perspicax and folds one into a Perspicax person once", () => {
    const path = join(mkdtempSync(join(tmpdir(), "interim-")), "principals.json");
    const registry = new PrincipalRegistry({ path });
    registry.localOperator("owner@example.test");
    const eve = registry.forAccount({ email: "eve@example.test" });
    const person = registry.forSubject({ iss: "https://px.test", sub: "E1", claims: { email: "eve@example.test" } });
    expect(registry.listInterim().map((p) => p.id)).toEqual([eve.id]);
    // A Perspicax person or the local operator is never interim.
    expect(registry.markMerged(person.id, eve.id)).toBeNull();
    expect(registry.markMerged(registry.local()!.id, person.id)).toBeNull();
    const merged = registry.markMerged(eve.id, person.id, 42);
    expect(merged).toMatchObject({ mergedInto: person.id, mergedAt: 42 });
    expect(registry.markMerged(eve.id, person.id)).toBeNull();
    expect(registry.listInterim()).toEqual([]);
    // Still resolvable for history labels, and the merge survives a reload.
    expect(new PrincipalRegistry({ path }).byId(eve.id)).toMatchObject({ email: "eve@example.test", mergedInto: person.id });
    expect(registry.listBySubjectIssuer("https://px.test").map((p) => p.id)).toEqual([person.id]);
  });
});

describe("a person's organization role changes (2026-10-17, follow-up of #696)", () => {
  const ISS = "https://px.example.test";
  it("tells the role listeners once, with the role before, from a sign-in or the directory, never on creation", () => {
    const { reg } = registry();
    const seen: Array<{ id: string; before: string | undefined; after: string | undefined }> = [];
    reg.onRoleChanged((person, before) => seen.push({ id: person.id, before, after: person.orgRole }));
    const ada = reg.forSubject({ iss: ISS, sub: "ADA", orgRole: "admin" });
    reg.forSubject({ iss: ISS, sub: "ADA", orgRole: "admin" });
    expect(seen).toEqual([]);
    reg.upsertFromDirectory({ iss: ISS, sub: "ADA", orgRole: "member" });
    expect(seen).toEqual([{ id: ada.id, before: "admin", after: "member" }]);
    reg.forSubject({ iss: ISS, sub: "ADA", orgRole: "admin" });
    expect(seen.at(-1)).toEqual({ id: ada.id, before: "member", after: "admin" });
    // a sign-in without a role claim leaves the role, and says nothing
    reg.forSubject({ iss: ISS, sub: "ADA" });
    expect(seen).toHaveLength(2);
    // a listener that throws never stops the update
    reg.onRoleChanged(() => { throw new Error("boom"); });
    expect(reg.upsertFromDirectory({ iss: ISS, sub: "ADA", orgRole: "member" }).orgRole).toBe("member");
    expect(seen).toHaveLength(3);
  });
});
