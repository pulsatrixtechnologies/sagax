// #4621 review: the words of a gathered mail or text kept across a restart
// (proactive-sealed/) are content at rest, sealed under the bot's key like
// held steers (server/turns/held-steers.ts), and read back through the
// at-rest reader.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { atRestInfoSync, resetAtRestState, runAtRestMigration, setAtRestGrace } from "../encryption/content-at-rest.ts";
import { WORKSPACE_OWNER } from "../encryption/content-keys.ts";
import { closeMessageDb, closeMessageSearch, configureContentEncryption } from "../messages/message-db.ts";
import { ProactivePendingFile } from "./proactive-wake.ts";

describe("proactive sealed rows at rest (#4621 review)", () => {
  beforeEach(async () => {
    await closeMessageSearch();
    closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
    process.env.SAGAX_MCP_OAUTH_KEY = "cd".repeat(32);
    resetAtRestState();
    setAtRestGrace(0);
    configureContentEncryption({
      mode: "on",
      autoMigrate: false,
      resolveBotOwner: () => WORKSPACE_OWNER,
      resolveOwner: () => ({ owner: WORKSPACE_OWNER, confidential: false }),
    });
  });
  afterEach(async () => {
    resetAtRestState();
    await closeMessageSearch();
    closeMessageDb();
    delete process.env.SAGAX_MCP_OAUTH_KEY;
  });

  it("seals a mail's words under the bot's key, mode 0600, and a restart reads them back", async () => {
    const secret = "lantern-quartz-proactive-mail-secret";
    const file = join(DATA_DIR, "proactive-pending.json");
    const first = new ProactivePendingFile(file);
    first.set("wren", [{ botId: "wren", source: "mail", key: "mail-1", label: "Email", detail: secret, from: "alex@example.com" }]);
    const dir = join(DATA_DIR, "proactive-sealed");
    const [name] = readdirSync(dir);
    const path = join(dir, name!);
    await runAtRestMigration({ sliceMs: Infinity });
    expect(atRestInfoSync(path)?.sealed).toBe(true);
    expect(readFileSync(path).toString("latin1")).not.toContain(secret);
    expect(readFileSync(path).toString("latin1")).not.toContain("alex@example.com");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).not.toContain(secret);

    const second = new ProactivePendingFile(file);
    const [row] = second.take();
    expect(row?.ref.kind).toBe("sealed");
    expect(second.readSealed((row!.ref as { id: string }).id)).toMatchObject({ botId: "wren", key: "mail-1", detail: secret, from: "alex@example.com" });
    second.set("wren", []);
    expect(existsSync(path)).toBe(false);
  });
});
