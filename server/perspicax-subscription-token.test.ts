// PerspicaxDirectory.depositSubscriptionToken (Perspicax #384) against a
// mocked Perspicax: PUT with the link token and the person's sign-in token,
// the body as JSON (never a refresh token), every answer mapped, no token in
// a log line.
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PerspicaxDirectory, SUBJECT_TOKEN_HEADER } from "./perspicax-link.ts";
import { PrincipalRegistry } from "./principals.ts";

const ISSUER = "https://px.example.test";
const ORIGIN = "https://bot.example.test";
const TOKEN_A = `pxat1.${"a".repeat(43)}`;
const TOKEN_B = `pxat1.${"b".repeat(43)}`;
const SIGN_IN = `pxlo1.alice.${"s".repeat(40)}`;
const ACCESS = `sk-ant-oat01-${"x".repeat(40)}`;
const BODY = { provider: "anthropic" as const, access_token: ACCESS, expires_at: "2026-10-19T20:00:00.000Z" };

function setup(answer: (n: number) => Response) {
  const dir = mkdtempSync(join(tmpdir(), "px-subtoken-"));
  const linkFile = join(dir, "pulsabot.json");
  const writeLink = (token: string) => {
    writeFileSync(linkFile, JSON.stringify({ version: 1, issuer: ISSUER, client_id: "pulsa-bot", server_id: "01j9s3server0000000000000a", origin: ORIGIN, link_token: token }));
    chmodSync(linkFile, 0o600);
  };
  writeLink(TOKEN_A);
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const logs: string[] = [];
  const directory = new PerspicaxDirectory({
    issuer: ISSUER,
    serverBase: "http://perspicax:8787/",
    linkFile,
    expect: { issuer: ISSUER, publicOrigin: ORIGIN, clientId: "pulsa-bot" },
    principals: new PrincipalRegistry({ path: join(dir, "principals.json") }),
    onPersonOut: () => {},
    onRoleNarrowed: () => {},
    version: "0.5.24",
    log: (line) => logs.push(line),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
      calls.push({ url: String(input), method: init?.method ?? "GET", headers, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
      return answer(calls.length);
    }) as typeof fetch,
  });
  return { directory, calls, logs, writeLink };
}

const refusal = (status: number, code: string) => new Response(JSON.stringify({ code, message: `refused: ${code}`, details: {} }), { status, headers: { "content-type": "application/json" } });

describe("handing a personal run's subscription token to Perspicax", () => {
  it("PUTs the body with the link token and the person's sign-in token", async () => {
    const { directory, calls, logs } = setup(() => new Response(null, { status: 204 }));
    expect(await directory.depositSubscriptionToken(SIGN_IN, "run_01abc", BODY)).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "http://perspicax:8787/api/v1/agents/runs/run_01abc/subscription-token", method: "PUT" });
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN_A}`);
    expect(calls[0]!.headers[SUBJECT_TOKEN_HEADER]).toBe(SIGN_IN);
    expect(JSON.parse(calls[0]!.body!)).toEqual(BODY);
    expect(calls[0]!.body).not.toMatch(/refresh/i);
    expect(logs.join("\n")).not.toContain(ACCESS);
  });

  it("re-reads the link file once on a 401", async () => {
    const { directory, calls, writeLink } = setup((n) => {
      if (n === 1) { writeLink(TOKEN_B); return new Response(null, { status: 401 }); }
      return new Response(null, { status: 204 });
    });
    expect(await directory.depositSubscriptionToken(SIGN_IN, "run_01abc", BODY)).toEqual({ ok: true });
    expect(calls[1]!.headers.authorization).toBe(`Bearer ${TOKEN_B}`);
  });

  it("maps every refusal", async () => {
    const cases: [Response, string][] = [
      [refusal(403, "subject"), "subject"],
      [refusal(403, "forbidden"), "forbidden"],
      [refusal(404, "not_found"), "gone"],
      [refusal(400, "validation"), "rejected"],
      [new Response(null, { status: 405 }), "unsupported"],
      [new Response(null, { status: 502 }), "unreachable"],
    ];
    for (const [response, error] of cases) {
      const { directory } = setup(() => response);
      expect(await directory.depositSubscriptionToken(SIGN_IN, "run_01abc", BODY)).toMatchObject({ ok: false, error });
    }
  });

  it("refuses a run id that is not one before any call", async () => {
    const { directory, calls } = setup(() => new Response(null, { status: 204 }));
    expect(await directory.depositSubscriptionToken(SIGN_IN, "../users", BODY)).toMatchObject({ ok: false, error: "rejected" });
    expect(calls).toHaveLength(0);
  });
});
