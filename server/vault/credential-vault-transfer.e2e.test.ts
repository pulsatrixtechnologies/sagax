// Import and export of the credential vault through a real server in desktop
// mode: a fake Bitwarden file read in memory as the app reads it, its items
// imported, then exported back as each format and read again. An export
// without the desktop's owner capability, or without the plaintext
// acknowledgement, is refused, and the audit rows hold counts only. Fake
// values only (shared/fixtures/credential-vault-import).
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { exportVaultItems, parseVaultImportFile } from "../../shared/credential-vault-transfer.ts";
import { launchVerificationServer } from "../../scripts/control-omb.ts";

const FIXTURE = fileURLToPath(new URL("../shared/fixtures/credential-vault-import/bitwarden.json", import.meta.url));

it("imports a manager's file, exports it back through the gate, and audits counts only", async () => {
  const owner = randomBytes(32).toString("base64url");
  // a throwaway vault key, as the desktop shell hands over the keychain's
  const fixture = await launchVerificationServer({ ...process.env, SAGAX_TEST_DESKTOP_OWNER_TOKEN: owner, SAGAX_MCP_OAUTH_KEY: randomBytes(32).toString("hex") });
  const call = async (path: string, body: unknown, withOwner = true) => {
    const response = await fetch(fixture.info.url + path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: fixture.info.url, ...(withOwner ? { "x-openmausbot-desktop-owner": owner } : {}) },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, text, body: text ? JSON.parse(text) : null };
  };
  try {
    const parsed = await parseVaultImportFile(new Uint8Array(readFileSync(FIXTURE)));
    const imported = await call("/api/me/credentials/import", { format: parsed.format, duplicates: "skip", items: parsed.items });
    expect(imported.status, imported.text).toBe(200);
    expect(imported.body).toMatchObject({ created: 3, merged: 0, refused: 0 });
    expect(imported.text).not.toContain("fake-pass-bw-1");

    const listed = await call("/api/me/credentials/list", {});
    expect(listed.body.items.map((item: { name: string }) => item.name).sort()).toEqual(["Clé API démo", "Note Wi-Fi", "Portail démo"]);
    expect(listed.text).not.toContain("fake-pass-bw-1");

    expect((await call("/api/me/credentials/export", { format: "bitwarden-json" })).body).toMatchObject({ code: "acknowledge_required" });
    const noOwner = await call("/api/me/credentials/export", { format: "bitwarden-json", acknowledge: "plaintext" }, false);
    expect(noOwner.status).toBeGreaterThanOrEqual(400);
    expect(noOwner.text).not.toContain("fake-pass-bw-1");

    for (const format of ["bitwarden-json", "bitwarden-csv", "chrome-csv"] as const) {
      const exported = await call("/api/me/credentials/export", { format, acknowledge: "plaintext" });
      expect(exported.status, format).toBe(200);
      const file = exportVaultItems(exported.body.items, format);
      const back = await parseVaultImportFile(new TextEncoder().encode(file.text));
      expect(back.format).toBe(format);
      if (format === "chrome-csv") {
        expect(back.items.map((item) => item.kind)).toEqual(["login"]);
        expect(exported.body).toMatchObject({ notInFormat: 2, totpNotInFormat: 1 });
        expect(back.items[0]).not.toHaveProperty("totpSeed");
      } else {
        const byName = (items: typeof parsed.items) => [...items].sort((left, right) => left.name.localeCompare(right.name));
        expect(byName(back.items)).toEqual(byName(parsed.items));
      }
    }

    // the audit is written after the answer (fire and forget)
    const dir = join(fixture.info.dataDir, "admin-activity");
    const vaultRows = () => readdirSync(dir).flatMap((name) => readFileSync(join(dir, name), "utf8").trim().split("\n")).filter(Boolean)
      .map((line) => JSON.parse(line)).filter((row) => String(row.action).startsWith("credentials."));
    await expect.poll(() => vaultRows().map((row) => row.action), { timeout: 10_000 })
      .toEqual(["credentials.import", "credentials.export", "credentials.export", "credentials.export"]);
    const audit = JSON.stringify(vaultRows());
    for (const value of ["fake-pass-bw-1", "fake-api-key-0001", "alex@example.com", "Portail démo", "portal.example.com", "JBSWY3DPEHPK3PXP"]) expect(audit).not.toContain(value);
  } finally {
    await fixture.close();
  }
}, 120_000);
