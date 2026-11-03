// PerspicaxDirectory.eraseOwnAccount (2026-10-17) against a mocked
// Perspicax: both credentials and the version on the call, `{ confirm: true }`
// as JSON, every answer mapped (an older Perspicax without the route is
// `unsupported` only when the erasure header is absent), and
// PrincipalRegistry.erase (the person's personal information goes, the
// record stays, idempotent).
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ACCOUNT_ERASURE_HEADER, OWN_ACCOUNT_ERASE_PATH, PerspicaxDirectory, SUBJECT_TOKEN_HEADER } from "./perspicax-link.ts";
import { PrincipalRegistry } from "./auth/principals.ts";

const ISSUER = "https://px.example.test";
const ORIGIN = "https://bot.example.test";
const SERVER_ID = "01j9s3server0000000000000a";
const TOKEN_A = `pxat1.${"a".repeat(43)}`;
const TOKEN_B = `pxat1.${"b".repeat(43)}`;
const SIGN_IN = `pxlo1.alice.${"s".repeat(40)}`;

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  redirect?: RequestInit["redirect"];
}

function setup(answer: (seen: Seen, n: number) => Response) {
  const dir = mkdtempSync(join(tmpdir(), "px-own-erase-"));
  const linkFile = join(dir, "pulsabot.json");
  const writeLink = (token: string) => {
    writeFileSync(linkFile, JSON.stringify({ version: 1, issuer: ISSUER, client_id: "pulsa-bot", server_id: SERVER_ID, origin: ORIGIN, link_token: token }));
    chmodSync(linkFile, 0o600);
  };
  writeLink(TOKEN_A);
  const calls: Seen[] = [];
  const logs: string[] = [];
  const directory = new PerspicaxDirectory({
    issuer: ISSUER,
    serverBase: "http://perspicax:8787/",
    linkFile,
    expect: { issuer: ISSUER, publicOrigin: ORIGIN, clientId: "pulsa-bot" },
    principals: new PrincipalRegistry({ path: join(dir, "principals.json") }),
    onPersonOut: () => {},
    onRoleNarrowed: () => {},
    version: "0.5.15",
    log: (line) => logs.push(line),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
      const seen: Seen = { url: String(input), method: init?.method ?? "GET", headers, ...(typeof init?.body === "string" ? { body: init.body } : {}), ...(init?.redirect ? { redirect: init.redirect } : {}) };
      calls.push(seen);
      return answer(seen, calls.length);
    }) as typeof fetch,
  });
  return { directory, calls, logs, writeLink };
}

const answer = (status: number, body: unknown, marked = true) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: { "content-type": "application/json", ...(marked ? { [ACCOUNT_ERASURE_HEADER]: "1" } : {}) },
});
const refusal = (status: number, code: string, marked = true) => answer(status, { code, message: `refused: ${code}`, details: {} }, marked);

describe("erasing the person's own Perspicax account", () => {
  it("posts { confirm: true } with the link token, the person's sign-in token and the version, no redirects", async () => {
    const { directory, calls, logs } = setup(() => answer(200, { erased: true, sub: "alice", audit_id: "au1" }));
    expect(await directory.eraseOwnAccount(SIGN_IN)).toEqual({ ok: true, sub: "alice", auditId: "au1" });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(`http://perspicax:8787${OWN_ACCOUNT_ERASE_PATH}`);
    expect(OWN_ACCOUNT_ERASE_PATH).toBe("/api/v1/pulsabot/people/me/erase");
    expect(call.method).toBe("POST");
    expect(call.redirect).toBe("error");
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN_A}`);
    expect(call.headers[SUBJECT_TOKEN_HEADER]).toBe(SIGN_IN);
    expect(call.headers["x-pulsabot-version"]).toBe("0.5.15");
    expect(call.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(call.body!)).toEqual({ confirm: true });
    expect(logs.join("\n")).not.toContain(SIGN_IN);
    expect(logs.join("\n")).not.toContain(TOKEN_A);
  });

  it("re-reads a rotated link token once after a 401", async () => {
    const { directory, calls, writeLink } = setup((seen, n) => {
      if (n === 1) {
        writeLink(TOKEN_B);
        return new Response(null, { status: 401 });
      }
      return seen.headers.authorization === `Bearer ${TOKEN_B}` ? answer(200, { erased: true, sub: "alice", audit_id: "au2" }) : new Response(null, { status: 401 });
    });
    expect(await directory.eraseOwnAccount(SIGN_IN)).toMatchObject({ ok: true, sub: "alice" });
    expect(calls).toHaveLength(2);
  });

  it.each([
    ["a 401 for the link token, even without the header", () => new Response(null, { status: 401 }), { error: "link", status: 401 }],
    ["a refused sign-in token", () => refusal(403, "subject"), { error: "subject", status: 403 }],
    ["no recent sign-in on the token (2026-10-18)", () => refusal(403, "reauth_required"), { error: "reauth_required", status: 403 }],
    ["the last active admin", () => refusal(409, "last_admin"), { error: "last_admin", status: 409 }],
    ["a key a product still uses", () => refusal(409, "bound"), { error: "bound", status: 409 }],
    ["a link or service account", () => refusal(409, "conflict"), { error: "refused", status: 409 }],
    ["an unconfirmed body", () => refusal(400, "confirm"), { error: "refused", status: 400 }],
    ["no directory person (404 with the header)", () => refusal(404, "not_found"), { error: "refused", status: 404 }],
    ["an older Perspicax (404 without the header)", () => new Response("not found", { status: 404 }), { error: "unsupported", status: 404 }],
    ["an older Perspicax (405 without the header)", () => new Response(null, { status: 405 }), { error: "unsupported", status: 405 }],
    ["a 403 that is not about the subject", () => refusal(403, "forbidden"), { error: "refused", status: 403 }],
    ["a 5xx", () => refusal(503, "unavailable"), { error: "unreachable", status: 503 }],
    ["a 200 that says nothing was erased", () => answer(200, { erased: false, sub: "alice" }), { error: "unreachable", status: 200 }],
    ["a 200 that is not JSON", () => new Response("<html>", { status: 200 }), { error: "unreachable", status: 200 }],
  ] as const)("maps %s", async (_what, reply, expected) => {
    const { directory } = setup(() => reply());
    expect(await directory.eraseOwnAccount(SIGN_IN)).toEqual({ ok: false, ...expected });
  });

  it("answers unreachable when the call fails, link when there is no link file", async () => {
    const { directory } = setup(() => { throw new Error("connect refused"); });
    expect(await directory.eraseOwnAccount(SIGN_IN)).toEqual({ ok: false, error: "unreachable" });
    const missing = new PerspicaxDirectory({
      issuer: ISSUER, serverBase: "http://perspicax:8787", linkFile: join(tmpdir(), "px-own-erase-missing", "pulsabot.json"),
      expect: { issuer: ISSUER, publicOrigin: ORIGIN, clientId: "pulsa-bot" },
      principals: new PrincipalRegistry({ path: join(mkdtempSync(join(tmpdir(), "px-own-erase-")), "principals.json") }),
      onPersonOut: () => {}, onRoleNarrowed: () => {}, version: "0.5.15", log: () => {},
      fetch: (async () => { throw new Error("never called"); }) as typeof fetch,
    });
    expect(await missing.eraseOwnAccount(SIGN_IN)).toEqual({ ok: false, error: "link" });
  });
});

describe("PrincipalRegistry.erase", () => {
  const registry = () => new PrincipalRegistry({ path: join(mkdtempSync(join(tmpdir(), "px-principal-erase-")), "principals.json") });

  it("drops the person's personal information, keeps the record out and stays erased", () => {
    const people = registry();
    const disabled: boolean[] = [];
    people.onDisabledChanged((_person, value) => disabled.push(value));
    const ada = people.forSubject({ iss: ISSUER, sub: "ada", claims: { email: "ada@example.test", name: "Ada Example", login: "ada", avatar: "v1" }, orgRole: "member", teams: [{ id: "T1" }], perspicaxRole: "employee" });
    people.setLabel(ada.id, "Lead");
    const erased = people.erase(ada.id, 1_000)!;
    expect(erased).toMatchObject({ id: ada.id, kind: "human", subject: { iss: ISSUER, sub: "ada" }, disabledAt: 1_000, erasedAt: 1_000 });
    for (const key of ["email", "name", "login", "avatar", "label", "teams"] as const) expect(erased[key]).toBeUndefined();
    expect(disabled).toEqual([true]);
    // idempotent
    expect(people.erase(ada.id, 2_000)).toMatchObject({ disabledAt: 1_000, erasedAt: 1_000 });
    expect(disabled).toEqual([true]);
    // a directory answer fetched before the erasure fills nothing again
    people.upsertFromDirectory({ iss: ISSUER, sub: "ada", name: "Ada Example", login: "ada", email: "ada@example.test", avatar: "v2", orgRole: "member" });
    expect(people.markEnabled(ISSUER, "ada", 5_000)).toBeNull();
    const after = people.byId(ada.id)!;
    expect(after.name).toBeUndefined();
    expect(after.email).toBeUndefined();
    expect(after.disabledAt).toBe(1_000);
    // persisted
    expect(people.bySubject(ISSUER, "ada")?.erasedAt).toBe(1_000);
  });

  it("never erases the local operator nor an unknown id", () => {
    const people = registry();
    const operator = people.localOperator("owner@example.test");
    expect(people.erase(operator.id)).toBeNull();
    expect(people.byId(operator.id)?.email).toBe("owner@example.test");
    expect(people.erase("pr_00000000-0000-4000-8000-000000000009")).toBeNull();
  });
});
