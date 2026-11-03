import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../../scripts/control-omb.ts";

const WITNESS = "witness-key-not-a-secret";
const GLM = "witness-glm-not-secret";

// A pasted key is sealed, answered only as configured, and never written
// into the Hermes home the CLI would read. The witness is a fixture, not
// a credential.
it("seals a pasted access key and leaves the Hermes dotenv unread", async () => {
  const fixture = await launchVerificationServer();
  try {
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`${fixture.info.url}${path}`, {
        method,
        headers: { "content-type": "application/json", origin: fixture.info.url },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { status: response.status, text };
    };

    const saved = await call("POST", "/api/instances/cursor/api-key", { key: WITNESS });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.text).not.toContain(WITNESS);
    const savedBody = JSON.parse(saved.text) as { configured?: boolean };
    expect(savedBody).toEqual({ configured: true });

    const read = await call("GET", "/api/instances/cursor/api-key");
    expect(read.status, read.text).toBe(200);
    expect(JSON.parse(read.text)).toEqual({ configured: true });
    expect(read.text).not.toContain(WITNESS);

    const enc = readFileSync(join(fixture.info.dataDir, "provider-keys.enc"));
    expect(enc.includes(Buffer.from(WITNESS))).toBe(false);
    expect(enc.includes(Buffer.from("CURSOR_API_KEY"))).toBe(false);

    const log = readFileSync(fixture.info.logPath, "utf8");
    expect(log).not.toContain(WITNESS);

    const userEnv = join(fixture.info.dataDir, ".hermes", ".env");
    expect(existsSync(userEnv)).toBe(false);

    const glm = await call("POST", "/api/instances/hermes/api-key", { key: GLM, provider: "glm" });
    expect(glm.status, glm.text).toBe(200);
    expect(glm.text).not.toContain(GLM);
    expect(existsSync(userEnv)).toBe(false);
    const sealed = readFileSync(join(fixture.info.dataDir, "provider-keys.enc"));
    expect(sealed.includes(Buffer.from(GLM))).toBe(false);
    expect(sealed.includes(Buffer.from(WITNESS))).toBe(false);

    const shaped = await call("POST", "/api/instances/cursor/api-key", { key: "has space" });
    expect(shaped.status).toBe(400);
    expect(shaped.text).not.toContain("has space");
  } finally {
    await fixture.close();
  }
}, 120_000);
