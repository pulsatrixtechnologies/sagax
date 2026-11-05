import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { applySignedBrowserHeaders } from "./web-bot-auth-apply.ts";
import { signBrowserVisit, signatureStillCovers, verifyBrowserVisit, visitTarget, WebBotAuthStore, webBotAuthScope } from "./web-bot-auth.ts";

const KEY = Buffer.alloc(32, 9);

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function store() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-web-bot-auth-"));
  dirs.push(dir);
  return new WebBotAuthStore(dir, () => ({ kind: "key", key: KEY }));
}

describe("web bot auth", () => {
  it("is on until the person turns it off, and one person does not change another", () => {
    const saved = store();
    const ada = webBotAuthScope(true, "pr_ada");
    const bob = webBotAuthScope(true, "pr_bob");
    expect(ada && bob).toBeTruthy();
    if (!ada || !bob) return;
    expect(saved.enabled(ada)).toBe(true);
    saved.setEnabled(ada, false);
    expect(saved.enabled(ada)).toBe(false);
    expect(saved.enabled(bob)).toBe(true);
    expect(saved.view(ada).enabled).toBe(false);
    expect(JSON.stringify(saved.view(ada))).not.toMatch(/pkcs8|private/i);
  });

  it("signs a visit the public key can verify, and never a login header", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-web-bot-auth-"));
    dirs.push(dir);
    const saved = new WebBotAuthStore(dir, () => ({ kind: "key", key: KEY }));
    const scope = webBotAuthScope(false, null);
    expect(scope).toEqual({ organization: false });
    if (!scope) return;
    const now = 1_700_000_000_000;
    const target = visitTarget("https://example.test/a");
    expect(target).toEqual({ authority: "example.test", path: "/a" });
    if (!target) return;
    const signed = signBrowserVisit(saved.material(scope), now, target);
    expect(Object.keys(signed.headers).sort()).toEqual(["Signature", "Signature-Agent", "Signature-Input"]);
    expect(signed.headers["Signature-Input"]).toContain('"@authority" "@path"');
    expect(verifyBrowserVisit(signed.headers, now, target)).toBe(true);
    expect(verifyBrowserVisit(signed.headers, now, { authority: "other.test", path: "/a" })).toBe(false);
    expect(verifyBrowserVisit(signed.headers, now, { authority: "example.test", path: "/b" })).toBe(false);
    expect(verifyBrowserVisit(signed.headers, now + 601_000, target)).toBe(false);
    const tampered = { ...signed.headers, Signature: signed.headers.Signature!.replace(/.$/, "A") };
    expect(verifyBrowserVisit(tampered, now, target)).toBe(false);
    const keyFile = readFileSync(join(dir, "web-bot-auth-key.json"), "utf8");
    expect(keyFile).not.toContain("pkcs8");
    expect(signatureStillCovers({ authority: target.authority, path: target.path, expiresAtMs: signed.expiresAtMs }, target, now)).toBe(true);
    expect(signatureStillCovers({ authority: target.authority, path: "/b", expiresAtMs: signed.expiresAtMs }, target, now)).toBe(false);
  });

  it("runs the engine with arguments, not a shell", async () => {
    const seen: Array<{ command: string; args: readonly string[]; shell: unknown }> = [];
    const spawnImpl = ((command: string, args: readonly string[], options: { shell?: unknown }) => {
      seen.push({ command, args, shell: options.shell });
      const handlers = new Map<string, (code?: number) => void>();
      return {
        kill() {},
        on(event: string, fn: (code?: number) => void) {
          handlers.set(event, fn);
          if (event === "close") queueMicrotask(() => fn(0));
          return this;
        },
      };
    }) as unknown as Parameters<typeof applySignedBrowserHeaders>[3];
    await applySignedBrowserHeaders("/engine/browser", { PATH: "/usr/bin" }, { "Signature-Agent": "data:application/json,{}" }, spawnImpl);
    expect(seen).toEqual([{
      command: "/engine/browser",
      args: ["set", "headers", JSON.stringify({ "Signature-Agent": "data:application/json,{}" })],
      shell: false,
    }]);
    await expect(applySignedBrowserHeaders("/engine/browser", {}, { Authorization: "Bearer x" }, spawnImpl)).rejects.toThrow(/not a login/);
  });

  it("runs a real process, and a process that rejects the signature fails the call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-web-bot-auth-bin-"));
    dirs.push(dir);
    const receipt = join(dir, "argv.txt");
    const bin = join(dir, "engine.mjs");
    writeFileSync(bin, `import { writeFileSync } from "node:fs"; writeFileSync(process.env.RECEIPT, JSON.stringify(process.argv.slice(1))); if (process.argv[2] !== "set" || process.argv[3] !== "headers") process.exit(2);\n`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [bin, "set", "headers", "{}"], { env: { ...process.env, RECEIPT: receipt }, shell: false });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    });
    expect(JSON.parse(readFileSync(receipt, "utf8"))).toEqual([bin, "set", "headers", "{}"]);
    await expect(applySignedBrowserHeaders(process.execPath, { PATH: process.env.PATH ?? "" }, { "Signature-Agent": "x" })).rejects.toThrow(/visit signature/);
  });
});
