import { describe, expect, it } from "vitest";
import { applyMailSettingsPatch, DEFAULT_MAIL_FROM_NAME, mailReady, mailSettingsPatchSchema, mailSettingsView, missingMailFields, publicMailStatus, resolveMailSettings } from "./mail-config.ts";

describe("mail settings", () => {
  it("lets a saved value win over the environment, which fills the rest", () => {
    const r = resolveMailSettings({
      file: { provider: "sendgrid", from: "web@example.com", sendgrid: { apiKey: "SG.file" } },
      env: { SAGAX_MAIL_PROVIDER: "smtp", SAGAX_MAIL_FROM: "env@example.com", SAGAX_SMTP_HOST: "smtp.example.com", SAGAX_SMTP_PORT: "587", SAGAX_SMTP_SECURE: "starttls", SAGAX_SMTP_PASSWORD: "pw" },
    });
    expect(r.settings.provider).toBe("sendgrid");
    expect(r.settings.from).toBe("web@example.com");
    expect(r.settings.sendgrid?.apiKey).toBe("SG.file");
    expect(r.settings.smtp).toMatchObject({ host: "smtp.example.com", port: 587, secure: "starttls", password: "pw" });
    expect(r.envManaged.sort()).toEqual(["from", "provider", "smtp.host", "smtp.password", "smtp.port", "smtp.secure"]);
    expect(r.saved.sort()).toEqual(["from", "provider", "sendgrid.apiKey"]);
    expect(r.server.provider).toBe("smtp");
    expect(r.server.from).toBe("env@example.com");
  });

  it("reads the sender name from SAGAX_MAIL_FROM_NAME and lets a saved one win", () => {
    expect(resolveMailSettings({ file: undefined, env: { SAGAX_MAIL_FROM_NAME: "Example" } }).settings.fromName).toBe("Example");
    const r = resolveMailSettings({ file: { fromName: "Pulsa" }, env: { SAGAX_MAIL_FROM_NAME: "Example" } });
    expect(r.settings.fromName).toBe("Pulsa");
    expect(r.envManaged).toContain("fromName");
    expect(r.saved).toContain("fromName");
  });

  it("reads a secret from a _FILE path, and the direct value wins", () => {
    const files: Record<string, string> = { "/run/secrets/sg": "SG.fromfile\n" };
    const read = (p: string) => files[p]!;
    expect(resolveMailSettings({ file: undefined, env: { SAGAX_SENDGRID_API_KEY_FILE: "/run/secrets/sg" }, readFile: read }).settings.sendgrid?.apiKey).toBe("SG.fromfile");
    expect(resolveMailSettings({ file: undefined, env: { SAGAX_SENDGRID_API_KEY_FILE: "/run/secrets/sg", SAGAX_SENDGRID_API_KEY: "SG.direct" }, readFile: read }).settings.sendgrid?.apiKey).toBe("SG.direct");
  });

  it("is ready only with a provider, a sender and that provider's fields", () => {
    expect(mailReady({})).toBe(false);
    expect(mailReady({ provider: "smtp", from: "a@b.c" })).toBe(false);
    expect(mailReady({ provider: "smtp", from: "a@b.c", smtp: { host: "h" } })).toBe(true);
    expect(mailReady({ provider: "sendgrid", from: "a@b.c", sendgrid: { apiKey: "k" } })).toBe(true);
    expect(mailReady({ provider: "twilio", from: "a@b.c", twilio: { apiKeySid: "SKfake" } })).toBe(false);
    expect(mailReady({ provider: "twilio", from: "a@b.c", twilio: { apiKeySecret: "fake-secret" } })).toBe(false);
    expect(mailReady({ provider: "twilio", twilio: { apiKeySid: "SKfake", apiKeySecret: "fake-secret" } })).toBe(false);
    expect(mailReady({ provider: "twilio", from: "a@b.c", twilio: { apiKeySid: "SKfake", apiKeySecret: "fake-secret" } })).toBe(true);
  });

  it("reads Twilio settings from the environment, the secret from a _FILE path, and the direct value wins", () => {
    const files: Record<string, string> = { "/run/secrets/twilio": "fake-secret-from-file\n" };
    const read = (p: string) => files[p]!;
    const fromFile = resolveMailSettings({
      file: undefined,
      env: { SAGAX_MAIL_PROVIDER: "twilio", SAGAX_TWILIO_API_KEY_SID: "SKenv", SAGAX_TWILIO_API_KEY_SECRET_FILE: "/run/secrets/twilio" },
      readFile: read,
    });
    expect(fromFile.settings.provider).toBe("twilio");
    expect(fromFile.settings.twilio).toEqual({ apiKeySid: "SKenv", apiKeySecret: "fake-secret-from-file" });
    expect(fromFile.envManaged.sort()).toEqual(["provider", "twilio.apiKeySecret", "twilio.apiKeySid"]);
    const direct = resolveMailSettings({
      file: undefined,
      env: { SAGAX_TWILIO_API_KEY_SECRET_FILE: "/run/secrets/twilio", SAGAX_TWILIO_API_KEY_SECRET: "fake-secret-direct" },
      readFile: read,
    });
    expect(direct.settings.twilio?.apiKeySecret).toBe("fake-secret-direct");
  });

  it("ignores a malformed SMTP port instead of truncating it", () => {
    for (const bad of ["587abc", "587.9", "0", "70000"]) {
      const r = resolveMailSettings({ file: undefined, env: { SAGAX_SMTP_PORT: bad } });
      expect(r.settings.smtp?.port).toBeUndefined();
      expect(r.envManaged).not.toContain("smtp.port");
    }
    const r = resolveMailSettings({ file: undefined, env: { SAGAX_SMTP_PORT: "2525" } });
    expect(r.settings.smtp?.port).toBe(2525);
    expect(r.envManaged).toContain("smtp.port");
  });

  it("never exposes a secret in the public status", () => {
    const status = publicMailStatus(resolveMailSettings({ file: { provider: "smtp", from: "a@b.c", smtp: { host: "h", password: "hunter2" }, sendgrid: { apiKey: "SG.secret" } }, env: {} }));
    const text = JSON.stringify(status);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("SG.secret");
    expect(status.smtp.passwordConfigured).toBe(true);
    expect(status.sendgrid.apiKeyConfigured).toBe(true);
  });

  it("shows the Twilio key SID but never its secret", () => {
    const status = publicMailStatus(resolveMailSettings({ file: undefined, env: { SAGAX_MAIL_PROVIDER: "twilio", SAGAX_MAIL_FROM: "a@b.c", SAGAX_TWILIO_API_KEY_SID: "SKfakesid", SAGAX_TWILIO_API_KEY_SECRET: "fake-twilio-secret" } }));
    expect(JSON.stringify(status)).not.toContain("fake-twilio-secret");
    expect(status.twilio).toEqual({ apiKeySid: "SKfakesid", apiKeySecretConfigured: true });
    expect(status.ready).toBe(true);
    const empty = publicMailStatus(resolveMailSettings({ file: undefined, env: {} }));
    expect(empty.twilio).toEqual({ apiKeySid: undefined, apiKeySecretConfigured: false });
  });

  it("names the fields that keep mail from being ready", () => {
    expect(missingMailFields({})).toEqual(["provider", "from"]);
    expect(missingMailFields({ provider: "twilio", from: "a@b.c", twilio: { apiKeySid: "SKfake" } })).toEqual(["twilio.apiKeySecret"]);
    expect(missingMailFields({ provider: "smtp", from: "a@b.c", smtp: { host: "h" } })).toEqual([]);
  });
});

// Long, unique fake secrets so a prefix or a fragment would be found too.
const SAVED_SECRET = "zq9Xw7LmPr4tVb2Nk8Yd";
const ENV_SECRET = "Hj3Ks6Wq1Ez5Rt8Uy0Io";
const SMTP_SECRET = "Pm7Gb4Nc2Vx9Lk5Jh1Df";

function fragments(secret: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 4 <= secret.length; i++) out.push(secret.slice(i, i + 4));
  return out;
}

describe("the mail settings view", () => {
  const resolved = () => resolveMailSettings({
    file: { provider: "twilio", from: "bot@example.com", twilio: { apiKeySid: "SKfakesid", apiKeySecret: SAVED_SECRET }, smtp: { password: SMTP_SECRET } },
    env: { SAGAX_MAIL_PROVIDER: "sendgrid", SAGAX_SENDGRID_API_KEY: ENV_SECRET, SAGAX_SMTP_HOST: "smtp.example.com" },
  });

  it("never carries a secret, not even a fragment of one", () => {
    const text = JSON.stringify(mailSettingsView(resolved()));
    for (const secret of [SAVED_SECRET, ENV_SECRET, SMTP_SECRET]) {
      for (const part of fragments(secret)) expect(text).not.toContain(part);
    }
    const view = mailSettingsView(resolved());
    expect(view.fields["twilio.apiKeySecret"]).toEqual({ source: "saved", serverDefault: false, configured: true });
    expect(view.fields["sendgrid.apiKey"]).toEqual({ source: "server", serverDefault: true, configured: true });
    expect(view.fields["smtp.password"]).toEqual({ source: "saved", serverDefault: false, configured: true });
  });

  it("says where each value comes from and what the server would use", () => {
    const view = mailSettingsView(resolved());
    expect(view.fields.provider).toEqual({ source: "saved", serverDefault: true, value: "twilio", serverValue: "sendgrid" });
    expect(view.fields["smtp.host"]).toEqual({ source: "server", serverDefault: true, value: "smtp.example.com", serverValue: "smtp.example.com" });
    expect(view.fields.fromName).toEqual({ source: "unset", serverDefault: false });
    expect(view.defaultFromName).toBe("Sagax");
    expect(view.ready).toBe(true);
    expect(view.missing).toEqual([]);
  });
});

describe("a mail settings change", () => {
  it("sets, keeps and reverts fields one by one", () => {
    const saved = { provider: "smtp" as const, from: "old@example.com", smtp: { host: "h", password: "fake-old" } };
    const next = applyMailSettingsPatch(saved, mailSettingsPatchSchema.parse({ from: "new@example.com", "smtp.host": null, fromName: "Example" }));
    expect(next).toEqual({ provider: "smtp", from: "new@example.com", fromName: "Example", smtp: { password: "fake-old" } });
    expect(saved.smtp.host).toBe("h");
    const cleared = applyMailSettingsPatch(next, mailSettingsPatchSchema.parse({ provider: null, from: null, fromName: null, "smtp.password": null }));
    expect(cleared).toEqual({});
  });

  it("keeps a secret that the change does not name (write-only)", () => {
    const next = applyMailSettingsPatch({ twilio: { apiKeySid: "SKa", apiKeySecret: "fake-keep" } }, mailSettingsPatchSchema.parse({ "twilio.apiKeySid": "SKb" }));
    expect(next.twilio).toEqual({ apiKeySid: "SKb", apiKeySecret: "fake-keep" });
  });

  it("refuses unknown fields, a sender with a name in it, header breaks and bad ports", () => {
    for (const bad of [
      { to: "x@y.z" },
      { from: "Sagax <bot@example.com>" },
      { from: "not-an-address" },
      { fromName: "Example\r\nBcc: x@y.z" },
      { fromName: "A <b>" },
      { "smtp.port": 0 },
      { "smtp.port": 70000 },
      { "smtp.host": "smtp host" },
      { "sendgrid.apiKey": "" },
      { "twilio.apiKeySecret": "line\nbreak" },
      { provider: "pigeon" },
    ]) expect(mailSettingsPatchSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it("names the default sender", () => {
    expect(DEFAULT_MAIL_FROM_NAME).toBe("Sagax");
  });
});

