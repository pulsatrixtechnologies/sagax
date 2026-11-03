// PerspicaxDirectory.writeOwnAvatar (2026-10-16) against a mocked Perspicax:
// both credentials on every call, the image as multipart `file`, the
// answers mapped, and the cached image dropped by forgetAvatar.
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { OWN_AVATAR_PATH, PerspicaxDirectory, SUBJECT_TOKEN_HEADER, type AvatarImage } from "./perspicax-link.ts";
import { PrincipalRegistry } from "./auth/principals.ts";

const ISSUER = "https://px.example.test";
const ORIGIN = "https://bot.example.test";
const SERVER_ID = "01j9s3server0000000000000a";
const TOKEN_A = `pxat1.${"a".repeat(43)}`;
const TOKEN_B = `pxat1.${"b".repeat(43)}`;
const SIGN_IN = `pxlo1.alice.${"s".repeat(40)}`;
const PNG: AvatarImage = { bytes: Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), contentType: "image/png" };

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  file?: { type: string; bytes: Buffer };
}

function setup(answer: (seen: Seen, n: number) => Response) {
  const dir = mkdtempSync(join(tmpdir(), "px-own-avatar-"));
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
    serverBase: "http://perspicax:8787",
    linkFile,
    expect: { issuer: ISSUER, publicOrigin: ORIGIN, clientId: "pulsa-bot" },
    principals: new PrincipalRegistry({ path: join(dir, "principals.json") }),
    onPersonOut: () => {},
    onRoleNarrowed: () => {},
    version: "0.5.8",
    log: (line) => logs.push(line),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
      const seen: Seen = { url: String(input), method: init?.method ?? "GET", headers };
      if (init?.body instanceof FormData) {
        const file = init.body.get("file");
        if (file instanceof Blob) seen.file = { type: file.type, bytes: Buffer.from(await file.arrayBuffer()) };
      }
      calls.push(seen);
      return answer(seen, calls.length);
    }) as typeof fetch,
  });
  return { directory, calls, logs, writeLink };
}

const ok = (avatar: string | null) => new Response(JSON.stringify({ audit_id: "a1", value: { sub: "alice", avatar } }), { status: 200, headers: { "content-type": "application/json" } });

describe("writing the person's own avatar to Perspicax", () => {
  it("sends the link token and the person's sign-in token, and the image as multipart", async () => {
    const { directory, calls, logs } = setup(() => ok("0123456789abcdef"));
    expect(await directory.writeOwnAvatar(SIGN_IN, PNG)).toEqual({ ok: true, avatar: "0123456789abcdef" });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(`http://perspicax:8787${OWN_AVATAR_PATH}`);
    expect(call.method).toBe("PUT");
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN_A}`);
    expect(call.headers[SUBJECT_TOKEN_HEADER]).toBe(SIGN_IN);
    expect(call.file).toEqual({ type: "image/png", bytes: PNG.bytes });
    // never a token in the log
    expect(logs.join("\n")).not.toContain(SIGN_IN);
    expect(logs.join("\n")).not.toContain(TOKEN_A);
  });

  it("removes with DELETE and no body", async () => {
    const { directory, calls } = setup(() => ok(null));
    expect(await directory.writeOwnAvatar(SIGN_IN, null)).toEqual({ ok: true, avatar: null });
    expect(calls[0]).toMatchObject({ method: "DELETE" });
    expect(calls[0]!.file).toBeUndefined();
    expect(calls[0]!.headers[SUBJECT_TOKEN_HEADER]).toBe(SIGN_IN);
  });

  it("re-reads a rotated link file once on 401", async () => {
    let rotate: (() => void) | null = null;
    const env = setup((seen) => {
      if (seen.headers.authorization === `Bearer ${TOKEN_B}`) return ok("fedcba9876543210");
      // Perspicax rotated the token: the file now holds B
      rotate?.();
      return new Response("{}", { status: 401 });
    });
    rotate = () => env.writeLink(TOKEN_B);
    expect(await env.directory.writeOwnAvatar(SIGN_IN, PNG)).toEqual({ ok: true, avatar: "fedcba9876543210" });
    expect(env.calls.map((call) => call.headers.authorization)).toEqual([`Bearer ${TOKEN_A}`, `Bearer ${TOKEN_B}`]);
  });

  it("maps Perspicax's refusals", async () => {
    const answers: Array<[Response, string]> = [
      [new Response(JSON.stringify({ code: "subject", message: "no" }), { status: 403 }), "subject"],
      [new Response(JSON.stringify({ code: "forbidden" }), { status: 403 }), "link"],
      [new Response("{}", { status: 401 }), "link"],
      [new Response("", { status: 405 }), "unsupported"],
      [new Response("", { status: 404 }), "unsupported"],
      [new Response(JSON.stringify({ code: "validation", message: "avatar must be a PNG or a JPEG" }), { status: 400 }), "rejected"],
      [new Response("", { status: 500 }), "unreachable"],
      // a 200 without a version is not trusted
      [new Response(JSON.stringify({ value: {} }), { status: 200 }), "unreachable"],
    ];
    for (const [response, error] of answers) {
      const { directory } = setup(() => response.clone());
      const result = await directory.writeOwnAvatar(SIGN_IN, PNG);
      expect(result, error).toMatchObject({ ok: false, error });
    }
  });

  it("answers unreachable when the call throws", async () => {
    const { directory } = setup(() => { throw new Error("ECONNREFUSED"); });
    expect(await directory.writeOwnAvatar(SIGN_IN, PNG)).toMatchObject({ ok: false, error: "unreachable" });
  });

  it("forgetAvatar drops the cached image so the next read asks Perspicax again", async () => {
    let reads = 0;
    const { directory } = setup((seen) => {
      if (seen.method === "GET") {
        reads += 1;
        return new Response(new Uint8Array(PNG.bytes), { status: 200, headers: { "content-type": "image/png" } });
      }
      return ok("0123456789abcdef");
    });
    await directory.avatar("alice", "v1");
    await directory.avatar("alice", "v1");
    expect(reads).toBe(1);
    directory.forgetAvatar("alice");
    await directory.avatar("alice", "v1");
    expect(reads).toBe(2);
  });
});
