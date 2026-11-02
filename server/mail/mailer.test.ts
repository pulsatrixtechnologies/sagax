import { describe, expect, it, vi } from "vitest";
import { createMailer, MailPartialSendError } from "./mailer.ts";

describe("mailer", () => {
  it("is absent until mail is configured", () => {
    expect(createMailer({})).toBeNull();
  });

  for (const provider of ["sendgrid", "twilio"] as const) {
    it(`${provider}: aborts a stalled send after 20 seconds without retrying`, async () => {
      const controller = new AbortController();
      const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
      const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
      }));
      try {
        const mailer = createMailer({ provider, from: "sender@example.test", sendgrid: { apiKey: "fake-key" }, twilio: { apiKeySid: "fake-sid", apiKeySecret: "fake-secret" } }, { fetchImpl: fetchImpl as typeof fetch })!;
        const sending = mailer.send({ to: "reader@example.test", subject: "Code", text: "Example" });
        const failed = expect(sending).rejects.toThrow(`${provider === "sendgrid" ? "SendGrid" : "Twilio"} did not answer within 20 seconds`);
        expect(timeout).toHaveBeenCalledWith(20_000);
        controller.abort(new DOMException("Timed out", "TimeoutError"));
        await failed;
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      } finally {
        timeout.mockRestore();
      }
    });
  }

  it("keeps the recipients already sent when a later Twilio copy times out", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockImplementationOnce(async (_url, init) => {
        controller.abort(new DOMException("Timed out", "TimeoutError"));
        throw init!.signal!.reason;
      });
    try {
      const mailer = createMailer({ provider: "twilio", from: "sender@example.test", twilio: { apiKeySid: "fake-sid", apiKeySecret: "fake-secret" } }, { fetchImpl })!;
      const failure = await mailer.send({ to: "reader@example.test", cc: ["copy@example.test"], subject: "Code", text: "Example" }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(MailPartialSendError);
      expect(failure).toMatchObject({ sent: ["reader@example.test"], message: "Twilio did not answer within 20 seconds" });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      timeout.mockRestore();
    }
  });

  it("sends through SendGrid's HTTP API", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const mailer = createMailer({ provider: "sendgrid", from: "pulsa@example.com", sendgrid: { apiKey: "SG.k" } }, { fetchImpl: fetchImpl as unknown as typeof fetch })!;
    await mailer.send({ to: "morgan@example.com", subject: "Code", text: "12345678" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer SG.k");
    expect(JSON.parse(String(init.body))).toMatchObject({ from: { email: "pulsa@example.com" }, personalizations: [{ to: [{ email: "morgan@example.com" }] }], subject: "Code" });
  });

  it("reports a SendGrid refusal without leaking the key", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 401 }));
    const mailer = createMailer({ provider: "sendgrid", from: "p@g.ca", sendgrid: { apiKey: "SG.k" } }, { fetchImpl: fetchImpl as unknown as typeof fetch })!;
    await expect(mailer.send({ to: "z@g.ca", subject: "s", text: "t" })).rejects.toThrow(/SendGrid refused the message \(401\)/);
    await expect(mailer.send({ to: "z@g.ca", subject: "s", text: "t" })).rejects.not.toThrow(/SG\.k/);
  });

  it("sends through the Twilio Email API with Basic auth", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ operationId: "op-fake", operationLocation: "https://comms.twilio.com/v1/Emails/Operations/op-fake" }), { status: 202 }));
    const mailer = createMailer({ provider: "twilio", from: "Sagax <pulsa@example.com>", twilio: { apiKeySid: "SKfakesid", apiKeySecret: "fake-secret" } }, { fetchImpl: fetchImpl as unknown as typeof fetch })!;
    await mailer.send({ to: "morgan@example.com", subject: "Code", text: "Your code: 12345678\n<ignore>" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://comms.twilio.com/v1/Emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from("SKfakesid:fake-secret").toString("base64")}`);
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      from: { address: "pulsa@example.com", name: "Sagax" },
      to: [{ address: "morgan@example.com" }],
      content: { subject: "Code", html: "Your code: 12345678<br>\n&lt;ignore&gt;", text: "Your code: 12345678\n<ignore>" },
    });
  });

  it("gives a bare Twilio sender address the default name Twilio requires", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const mailer = createMailer({ provider: "twilio", from: "pulsa@example.com", twilio: { apiKeySid: "SKfakesid", apiKeySecret: "fake-secret" } }, { fetchImpl: fetchImpl as unknown as typeof fetch })!;
    await mailer.send({ to: "z@g.ca", subject: "s", text: "t" });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).from).toEqual({ address: "pulsa@example.com", name: "Sagax" });
  });

  it("reports a Twilio refusal without leaking the secret", async () => {
    const secret = "fake-twilio-secret-value";
    const encoded = Buffer.from(`SKfakesid:${secret}`).toString("base64");
    // A hostile or verbose error body that echoes the credentials back.
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ errors: [{ code: "20003", message: `bad auth ${secret} ${encoded}` }], status: 401 }), { status: 401 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const mailer = createMailer({ provider: "twilio", from: "p@g.ca", twilio: { apiKeySid: "SKfakesid", apiKeySecret: secret } }, { fetchImpl: fetchImpl as unknown as typeof fetch })!;
      const failure = await mailer.send({ to: "z@g.ca", subject: "s", text: "t" }).then(() => null, (e: unknown) => e as Error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure!.message).toBe("Twilio refused the message (401): bad auth [redacted] [redacted] (20003)");
      const surfaced = `${failure!.message}\n${failure!.stack ?? ""}\n${JSON.stringify(failure)}`;
      expect(surfaced).not.toContain(secret);
      expect(surfaced).not.toContain(encoded);
      const logged = [...warn.mock.calls, ...error.mock.calls, ...log.mock.calls].map((c) => c.map(String).join(" ")).join("\n");
      expect(logged).not.toContain(secret);
      expect(logged).not.toContain(encoded);
      expect(JSON.stringify(mailer)).not.toContain(secret);
    } finally {
      warn.mockRestore();
      error.mockRestore();
      log.mockRestore();
    }
  });

  it("surfaces Twilio's own reason for a refusal", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ errors: [{ code: "invalid_from", message: "The from.address domain 'fake.example' is not valid or authorized." }], status: 400 }), { status: 400 }));
    const mailer = createMailer({ provider: "twilio", from: "p@fake.example", twilio: { apiKeySid: "SKfakesid", apiKeySecret: "fake-secret" } }, { fetchImpl: fetchImpl as unknown as typeof fetch })!;
    await expect(mailer.send({ to: "z@g.ca", subject: "s", text: "t" })).rejects.toThrow("Twilio refused the message (400): The from.address domain 'fake.example' is not valid or authorized. (invalid_from)");
  });

  it("keeps a Twilio refusal readable when the body is not JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>gateway</html>", { status: 502 }));
    const mailer = createMailer({ provider: "twilio", from: "p@g.ca", twilio: { apiKeySid: "SKfakesid", apiKeySecret: "fake-secret" } }, { fetchImpl: fetchImpl as unknown as typeof fetch })!;
    await expect(mailer.send({ to: "z@g.ca", subject: "s", text: "t" })).rejects.toThrow(/^Twilio refused the message \(502\)$/);
  });

  it("is absent for Twilio until the SID and the secret are both set", () => {
    expect(createMailer({ provider: "twilio", from: "p@g.ca", twilio: { apiKeySid: "SKfakesid" } })).toBeNull();
    expect(createMailer({ provider: "twilio", from: "p@g.ca", twilio: { apiKeySecret: "fake-secret" } })).toBeNull();
  });

  it("sends through SMTP with the chosen security", async () => {
    const sendMail = vi.fn(async () => ({}));
    const smtpTransport = vi.fn(() => ({ sendMail }));
    const mailer = createMailer({ provider: "smtp", from: "p@g.ca", smtp: { host: "smtp.g.ca", port: 587, secure: "starttls", user: "u", password: "pw" } }, { smtpTransport })!;
    await mailer.send({ to: "z@g.ca", subject: "s", text: "t" });
    expect(smtpTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.g.ca", port: 587, secure: false, requireTLS: true, auth: { user: "u", pass: "pw" } }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: { name: "Sagax", address: "p@g.ca" }, to: "z@g.ca", subject: "s", text: "t" }));
  });

  it("uses the configured sender name with every provider, and Sagax when none is set", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const twilio = createMailer({ provider: "twilio", from: "p@g.ca", fromName: "Example", twilio: { apiKeySid: "SKfakesid", apiKeySecret: "fake-secret" } }, { fetchImpl: fetchImpl as unknown as typeof fetch })!;
    await twilio.send({ to: "z@g.ca", subject: "s", text: "t" });
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).from).toEqual({ address: "p@g.ca", name: "Example" });
    const sendgrid = createMailer({ provider: "sendgrid", from: "p@g.ca", sendgrid: { apiKey: "SG.k" } }, { fetchImpl: fetchImpl as unknown as typeof fetch })!;
    await sendgrid.send({ to: "z@g.ca", subject: "s", text: "t" });
    expect(JSON.parse(String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body)).from).toEqual({ email: "p@g.ca", name: "Sagax" });
    const sendMail = vi.fn(async () => ({}));
    const smtp = createMailer({ provider: "smtp", from: "Old <p@g.ca>", fromName: "Example", smtp: { host: "smtp.g.ca" } }, { smtpTransport: () => ({ sendMail }) })!;
    await smtp.send({ to: "z@g.ca", subject: "s", text: "t" });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: { name: "Example", address: "p@g.ca" } }));
  });
});
