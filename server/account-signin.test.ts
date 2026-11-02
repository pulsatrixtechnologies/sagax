import { describe, expect, it, vi } from "vitest";

import { allowedScopes, createEmailSignIn, createServerEmailSignIn, parseAllowList, signInEnabled } from "./account-signin.ts";
import { EmailOtpStore } from "./mail/email-otp.ts";
import { startControlPlaneStub } from "./testing/control-plane-stub.ts";

describe("the sign-in allow-list", () => {
  it("splits on commas, spaces and newlines and ignores case", () => {
    expect(parseAllowList(" Her@Example.test, @Agentada.test\nstaff@example.test ")).toEqual(["her@example.test", "@agentada.test", "staff@example.test"]);
    expect(parseAllowList(undefined)).toEqual([]);
  });

  it("maps addresses and @domains to scopes, and never matches a look-alike domain", () => {
    const list = { admins: ["her@example.test", "@agentada.test"], members: ["staff@example.test", "@partner.test"] };
    expect(allowedScopes("HER@example.test", list)).toEqual(["admin", "client"]);
    expect(allowedScopes("anyone@agentada.test", list)).toEqual(["admin", "client"]);
    expect(allowedScopes("staff@example.test", list)).toEqual(["client"]);
    expect(allowedScopes("x@partner.test", list)).toEqual(["client"]);
    expect(allowedScopes("x@evilagentada.test", list)).toBeNull();
    expect(allowedScopes("x@agentada.test.evil", list)).toBeNull();
    expect(allowedScopes("@agentada.test", list)).toBeNull();
    expect(allowedScopes("stranger@example.test", list)).toBeNull();
    expect(signInEnabled(list)).toBe(true);
    expect(signInEnabled({ admins: [], members: [] })).toBe(false);
  });
});

describe("the exchange with the control plane", () => {
  it("sends a code only to welcome addresses, turns the right code into scopes, and explains the wrong one", async () => {
    const stub = await startControlPlaneStub();
    try {
      const signIn = createEmailSignIn({
        allow: { admins: ["her@example.test"], members: ["@team.test"] },
        env: { ...process.env, SAGAX_CONTROL_PLANE_URL: stub.url },
      });
      expect(signIn.enabled()).toBe(true);
      expect(await signIn.start("nobody@example.test")).toMatchObject({ ok: false, status: 403 });
      expect(await signIn.start("not an email")).toMatchObject({ ok: false, status: 400 });
      expect(stub.calls).not.toContain("POST /api/auth/email-otp/send-verification-otp");
      expect(await signIn.start("Her@Example.test")).toEqual({ ok: true });
      expect(stub.calls).toContain("POST /api/auth/email-otp/send-verification-otp");

      const wrong = await signIn.verify("her@example.test", "00000000");
      expect(wrong).toMatchObject({ ok: false, status: 401 });
      expect(wrong.ok ? "" : wrong.error).toMatch(/wrong or has expired/);
      expect(await signIn.verify("her@example.test", "12")).toMatchObject({ ok: false, status: 400 });
      expect(await signIn.verify("nobody@example.test", stub.otp)).toMatchObject({ ok: false, status: 403 });

      const admin = await signIn.verify("her@example.test", stub.otp);
      expect(admin).toEqual({ ok: true, email: "her@example.test", userId: "user_stub", scopes: ["admin", "client"] });
      const member = await signIn.verify("someone@team.test", stub.otp);
      expect(member).toMatchObject({ ok: true, scopes: ["client"] });
      await new Promise((r) => setTimeout(r, 50));
      expect(stub.calls.filter((call) => call === "POST /api/auth/sign-out").length).toBe(2);
    } finally {
      await stub.close();
    }
  });

  it("is off with an empty allow-list and says so when the sign-in service is down", async () => {
    const off = createEmailSignIn({ allow: () => ({ admins: [], members: [] }) });
    expect(off.enabled()).toBe(false);
    const down = createEmailSignIn({ allow: { admins: ["a@b.test"], members: [] }, env: { ...process.env, SAGAX_CONTROL_PLANE_URL: "http://127.0.0.1:9" } });
    expect(await down.start("a@b.test")).toMatchObject({ ok: false, status: 502 });
  });
});

describe("server-issued email sign-in", () => {
  const allow = { admins: ["owner@example.com"], members: ["@example.com"] };
  it("is disabled until mail is configured", () => {
    expect(createServerEmailSignIn({ allow, otp: new EmailOtpStore(), mailer: () => null }).enabled()).toBe(false);
  });
  it("mails a code to a welcome address and signs it in with the right scopes", async () => {
    const send = vi.fn(async (_message: { to: string; subject: string; text: string }) => undefined);
    const otp = new EmailOtpStore({ random: () => "24681357" });
    const signIn = createServerEmailSignIn({ allow, otp, mailer: () => ({ send }), publicUrl: () => "https://server.example.com" });
    expect(signIn.enabled()).toBe(true);
    expect(await signIn.start("morgan@example.com", "src")).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "morgan@example.com", text: expect.stringContaining("24681357") }));
    expect(send.mock.calls[0]![0].text).toContain("https://server.example.com/pair");
    expect(await signIn.verify("morgan@example.com", "24681357")).toEqual({ ok: true, email: "morgan@example.com", userId: "", scopes: ["client"] });
  });
  it("never mails an address that is not on the list", async () => {
    const send = vi.fn(async () => undefined);
    const signIn = createServerEmailSignIn({ allow, otp: new EmailOtpStore(), mailer: () => ({ send }) });
    expect(await signIn.start("stranger@other.com", "src")).toMatchObject({ ok: false, status: 403 });
    expect(send).not.toHaveBeenCalled();
  });
  it("reports a mail failure as 502 and keeps the code unusable", async () => {
    const signIn = createServerEmailSignIn({ allow, otp: new EmailOtpStore({ random: () => "11112222" }), mailer: () => ({ send: async () => { throw new Error("the mail server refused the message: 550"); } }) });
    expect(await signIn.start("morgan@example.com", "src")).toMatchObject({ ok: false, status: 502 });
    expect((await signIn.verify("morgan@example.com", "11112222")).ok).toBe(false);
  });
});
