// #4360: on a real server without an organization, a device paired as the
// person lists and uses their vault. A pairing is still not a recent sign-in:
// the first key and the export in clear stay refused on it (the desktop app,
// on the computer that runs it, does those). A headless server's loopback, a
// bot's shell included, never enrolls a first key, nor does a session it
// redeems from a code it made. An unpaired caller gets nothing.
import { expect, it } from "vitest";
import { launchVerificationServer } from "../../scripts/control-omb.ts";

it("lets a paired device use the vault on a solo server, never enroll a first key or export (#4360)", async () => {
  const fixture = await launchVerificationServer(process.env);
  const call = async (method: string, path: string, options: { token?: string; body?: unknown } = {}) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method,
      headers: { "content-type": "application/json", origin: fixture.info.url, ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    return { status: response.status, text, body: text ? JSON.parse(text) as any : null };
  };
  const pair = async (scopes?: string[]) => {
    const opened = await call("POST", "/api/auth/pairing", { body: scopes ? { scopes } : {} });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const paired = await call("POST", "/api/pair", { body: { credential: opened.body.credential, deviceName: "Phone" } });
    expect(paired.status, JSON.stringify(paired.body)).toBe(200);
    return paired.body.token as string;
  };
  try {
    // An unpaired caller (this computer's loopback on a headless server).
    const unpaired = await call("POST", "/api/me/credentials/list", { body: {} });
    expect(unpaired.status).toBe(403);
    expect(unpaired.body.code).toBe("not_paired");
    expect(unpaired.body.items).toBeUndefined();
    // The headless loopback (a bot's shell there) never enrolls a first key.
    expect((await call("GET", "/api/security-keys")).body.needsSignIn).toBe(true);
    const shell = await call("POST", "/api/security-keys/register", { body: { name: "Shell key", via: "desktop-window" } });
    expect(shell.status, shell.text).toBe(403);
    expect(shell.body.code).toBe("reauth_required");

    // A device paired as the person: its vault opens.
    const phone = await pair();
    const created = await call("POST", "/api/me/credentials", { token: phone, body: { kind: "login", name: "Supplier", username: "me", password: "fake-pass-solo-1", domains: ["supplier.example"] } });
    expect(created.status, created.text).toBe(201);
    const listed = await call("POST", "/api/me/credentials/list", { token: phone, body: {} });
    expect(listed.status, listed.text).toBe(200);
    expect(listed.body.items.map((item: { name: string }) => item.name)).toEqual(["Supplier"]);
    expect(listed.text).not.toContain("fake-pass-solo-1");

    // A pairing is not a recent sign-in: no first key, no export in clear.
    expect((await call("GET", "/api/security-keys", { token: phone })).body.needsSignIn).toBe(true);
    const register = await call("POST", "/api/security-keys/register", { token: phone, body: { name: "Phone key", via: "desktop-window" } });
    expect(register.status, register.text).toBe(403);
    expect(register.body.code).toBe("reauth_required");
    const exported = await call("POST", "/api/me/credentials/export", { token: phone, body: { format: "bitwarden-json", acknowledge: "plaintext" } });
    expect(exported.status, exported.text).toBe(403);
    expect(exported.body.code).toBe("reauth_required");
    expect(exported.text).not.toContain("fake-pass-solo-1");
  } finally {
    await fixture.close();
  }
}, 120_000);
