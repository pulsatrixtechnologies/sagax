# Organisation collaborative, tranche 1b: serveur géré par le web

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'opérateur d'un serveur Pulsa Bot dans Docker gère tout par le web. Il obtient le premier admin par un code lu dans le journal. Les codes de connexion et les invitations partent du serveur par SMTP ou SendGrid, avec une configuration dans Docker ou sur le web. L'admin redémarre le serveur et lit son journal depuis les réglages.

**Architecture:**
- **Courriels, trois modules purs:** `server/mail/email-otp.ts` (codes à usage unique), `server/mail/mail-config.ts` (résolution env + fichier, env prioritaire) et `server/mail/mailer.ts` (SMTP via nodemailer, SendGrid via `fetch`).
- **Connexion par courriel:** `createServerEmailSignIn` remplace l'appel au control plane et garde la même interface `EmailSignIn`.
- **Premier admin:** un module `server/first-admin.ts` décide s'il faut émettre le code au démarrage.
- **Journal:** `server/log-buffer.ts` garde en anneau les dernières lignes de sortie du processus.
- **Web:** deux nouvelles sections de réglages, « Courriel » et « Serveur ».

**Tech Stack:** TypeScript strict, Node 24, Vitest, Zod, nodemailer (nouvelle dépendance), React 19 + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-28-collaborative-org-design.md`, sections « Envoi de courriels » et « Serveur géré par le web ». Tranche 1b.

## Global Constraints

- **Variables d'environnement:**
  - `SAGAX_MAIL_PROVIDER` (`smtp` | `sendgrid`), `SAGAX_MAIL_FROM`.
  - SMTP: `SAGAX_SMTP_HOST`, `SAGAX_SMTP_PORT`, `SAGAX_SMTP_SECURE` (`tls` | `starttls` | `none`), `SAGAX_SMTP_USER`, `SAGAX_SMTP_PASSWORD`.
  - SendGrid: `SAGAX_SENDGRID_API_KEY`.
  - Les secrets (`SAGAX_SMTP_PASSWORD`, `SAGAX_SENDGRID_API_KEY`) acceptent aussi une variante `_FILE` (chemin d'un Docker secret). Si les deux sont présentes, la valeur directe gagne.
- **Priorité:** une valeur venue de l'environnement gagne. Le web la montre en lecture seule (« configuré par Docker »). Un PATCH qui tente de la changer reçoit 409 `{ error: "managed by the server environment", fields: [...] }` au lieu d'être écrasé en silence.
- **Secrets:** écriture seule. Les réponses GET ne renvoient jamais un mot de passe ni une clé, seulement `configured: boolean`.
- **Code de connexion:** 8 chiffres, valide 10 minutes, 5 essais au plus. Au plus 3 envois par adresse par 15 minutes, et au plus 10 par source par 15 minutes. Seul le haché sha256 est gardé en mémoire.
- **Sans fournisseur configuré:** `emailSignIn.enabled()` est faux, il n'y a ni connexion ni invitation par courriel, et l'appairage par code reste possible.
- **Premier admin:** le code n'est émis que si toutes ces conditions tiennent: aucune session vivante, `cfg.signIn.admins` vide, et `SAGAX_DESKTOP_PARENT !== "1"`. Scopes `["admin", "client"]`, principal = opérateur local, TTL 60 minutes. Une seule ligne de journal, préfixée `[first-admin]`, avec le lien `<publicUrl>/pair#code=<code>`. Nouveau code à chaque démarrage tant que la condition tient.
- **Redémarrage et journal:** seulement quand `SAGAX_DESKTOP_PARENT !== "1"`, sinon 404. Réservés au scope `admin`. Le redémarrage répond 202 puis envoie `SIGTERM` à soi-même après 300 ms: `createGracefulShutdown` sort proprement et Docker relance (`restart: unless-stopped`).
- **Journal en anneau:** 2000 lignes au plus, chaque ligne coupée à 2000 caractères.
- **Texte d'interface:** anglais dans `en.json`, français (Québec) dans `fr.json`, puis `node scripts/generate-locale.mjs fr --accept`. Pas de tiret cadratin ni de en-dash.
- **Tests et vérifications:** `npx vitest run <fichier>`, `pnpm -s typecheck`, `pnpm -s i18n:check`. La suite serveur a des échecs anciens; comparer avec une liste « avant » prise au début.

## Review Focus

1. Un secret (mot de passe SMTP, clé SendGrid) ne doit jamais apparaître dans une réponse HTTP, dans le journal ni dans le tampon du journal. Tests en Tasks 2, 4 et 6.
2. Un code de connexion deviné ou rejoué ne doit jamais ouvrir de session: code faux, expiré, déjà utilisé, sixième essai, autre adresse. Test en Task 1.
3. Le code du premier admin ne doit jamais être émis dès qu'un admin existe, ni dans l'app de bureau. Test en Task 5.
4. Le bouton de redémarrage et le journal ne doivent jamais exister pour un non-admin ni dans l'app de bureau (404 ou 403). Test en Task 6.
5. Un champ fixé par Docker ne doit jamais être écrasé par le web, même partiellement. Test en Task 4.

---

### Task 1: Codes de connexion émis par le serveur

**Files:**
- Create: `server/mail/email-otp.ts`
- Test: `server/mail/email-otp.test.ts`

**Interfaces:**
- Produces:
  - `class EmailOtpStore { constructor(options?: { now?: () => number; random?: () => string }); issue(email: string, source: string): { ok: true; code: string } | { ok: false; status: 429; error: string }; verify(email: string, code: string): { ok: true } | { ok: false; status: 400 | 401 | 429; error: string } }`
  - `OTP_TTL_MS = 10 * 60_000`, `OTP_MAX_ATTEMPTS = 5`, `OTP_SENDS_PER_ADDRESS = 3`, `OTP_SENDS_PER_SOURCE = 10`, `OTP_SEND_WINDOW_MS = 15 * 60_000`

- [ ] **Step 1: Write the failing test**

```ts
// server/mail/email-otp.test.ts
import { describe, expect, it } from "vitest";
import { EmailOtpStore, OTP_TTL_MS } from "./email-otp.ts";

function store(start = 1_000) {
  let clock = start;
  let n = 0;
  const codes = ["12345678", "87654321", "11112222", "33334444", "55556666"];
  const s = new EmailOtpStore({ now: () => clock, random: () => codes[n++ % codes.length]! });
  return { s, tick: (ms: number) => { clock += ms; } };
}

describe("email one-time codes", () => {
  it("accepts the code once, for that address only", () => {
    const { s } = store();
    const issued = s.issue("Morgan@example.com", "10.0.0.1");
    expect(issued).toEqual({ ok: true, code: "12345678" });
    expect(s.verify("other@example.com", "12345678").ok).toBe(false);
    expect(s.verify("morgan@example.com", "12345678")).toEqual({ ok: true });
    expect(s.verify("morgan@example.com", "12345678").ok).toBe(false);
  });

  it("expires after ten minutes", () => {
    const { s, tick } = store();
    s.issue("morgan@example.com", "src");
    tick(OTP_TTL_MS + 1);
    expect(s.verify("morgan@example.com", "12345678")).toMatchObject({ ok: false, status: 401 });
  });

  it("burns the code after five wrong tries", () => {
    const { s } = store();
    s.issue("morgan@example.com", "src");
    for (let i = 0; i < 5; i++) expect(s.verify("morgan@example.com", "00000000").ok).toBe(false);
    expect(s.verify("morgan@example.com", "12345678")).toMatchObject({ ok: false });
  });

  it("refuses a malformed code without counting it as a guess", () => {
    const { s } = store();
    s.issue("morgan@example.com", "src");
    expect(s.verify("morgan@example.com", "12ab")).toMatchObject({ ok: false, status: 400 });
    expect(s.verify("morgan@example.com", "12345678")).toEqual({ ok: true });
  });

  it("limits sends per address and per source", () => {
    const { s, tick } = store();
    for (let i = 0; i < 3; i++) expect(s.issue("morgan@example.com", `s${i}`).ok).toBe(true);
    expect(s.issue("morgan@example.com", "s9")).toMatchObject({ ok: false, status: 429 });
    for (let i = 0; i < 10; i++) s.issue(`p${i}@example.com`, "office");
    expect(s.issue("p99@example.com", "office")).toMatchObject({ ok: false, status: 429 });
    tick(15 * 60_000 + 1);
    expect(s.issue("morgan@example.com", "s10").ok).toBe(true);
  });

  it("keeps only the newest code for an address", () => {
    const { s } = store();
    s.issue("morgan@example.com", "a");
    s.issue("morgan@example.com", "b");
    expect(s.verify("morgan@example.com", "12345678").ok).toBe(false);
    expect(s.verify("morgan@example.com", "87654321")).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/mail/email-otp.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// server/mail/email-otp.ts
// Sign-in codes this server emails itself (no outside account service).
// Only a sha256 of each code is held, in memory: a restart simply voids
// codes in flight, which costs a person one more email.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_SENDS_PER_ADDRESS = 3;
export const OTP_SENDS_PER_SOURCE = 10;
export const OTP_SEND_WINDOW_MS = 15 * 60_000;

const digest = (value: string) => createHash("sha256").update(value).digest();
const key = (email: string) => email.trim().toLowerCase();

interface Pending { hash: Buffer; expiresAt: number; attempts: number }

export class EmailOtpStore {
  private readonly now: () => number;
  private readonly random: () => string;
  private readonly pending = new Map<string, Pending>();
  private readonly sends = new Map<string, number[]>();

  constructor(options: { now?: () => number; random?: () => string } = {}) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? (() => String(randomInt(0, 100_000_000)).padStart(8, "0"));
  }

  issue(email: string, source: string): { ok: true; code: string } | { ok: false; status: 429; error: string } {
    const now = this.now();
    const address = key(email);
    if (!this.allowSend(`a:${address}`, OTP_SENDS_PER_ADDRESS, now) || !this.allowSend(`s:${source}`, OTP_SENDS_PER_SOURCE, now)) {
      return { ok: false, status: 429, error: "too many codes requested; wait a few minutes and try again" };
    }
    const code = this.random();
    this.pending.set(address, { hash: digest(code), expiresAt: now + OTP_TTL_MS, attempts: 0 });
    return { ok: true, code };
  }

  verify(email: string, code: string): { ok: true } | { ok: false; status: 400 | 401 | 429; error: string } {
    const trimmed = code.replace(/\s+/g, "");
    if (!/^\d{8}$/.test(trimmed)) return { ok: false, status: 400, error: "enter the 8-digit code from the email" };
    const address = key(email);
    const entry = this.pending.get(address);
    if (!entry || this.now() > entry.expiresAt) {
      this.pending.delete(address);
      return { ok: false, status: 401, error: "that code is wrong or has expired; request a new one" };
    }
    if (!timingSafeEqual(entry.hash, digest(trimmed))) {
      entry.attempts += 1;
      if (entry.attempts >= OTP_MAX_ATTEMPTS) this.pending.delete(address);
      return { ok: false, status: 401, error: "that code is wrong or has expired; request a new one" };
    }
    this.pending.delete(address);
    return { ok: true };
  }

  private allowSend(bucket: string, limit: number, now: number): boolean {
    const recent = (this.sends.get(bucket) ?? []).filter((at) => now - at <= OTP_SEND_WINDOW_MS);
    if (recent.length >= limit) { this.sends.set(bucket, recent); return false; }
    recent.push(now);
    this.sends.set(bucket, recent);
    return true;
  }
}
```

- [ ] **Step 4: Run tests**, which must PASS: `npx vitest run server/mail/email-otp.test.ts`.
- [ ] **Step 5: Commit** `feat: issue email sign-in codes from the server`, followed by the Co-Authored-By line.

---

### Task 2: Configuration et envoi des courriels

**Files:**
- Create: `server/mail/mail-config.ts`, `server/mail/mailer.ts`
- Modify: `package.json` + `pnpm-lock.yaml` (`pnpm add nodemailer@^7` and `pnpm add -D @types/nodemailer`)
- Test: `server/mail/mail-config.test.ts`, `server/mail/mailer.test.ts`

**Interfaces:**
- Produces:
  - `type MailProvider = "smtp" | "sendgrid"`
  - `interface MailSettings { provider?: MailProvider; from?: string; smtp?: { host?: string; port?: number; secure?: "tls" | "starttls" | "none"; user?: string; password?: string }; sendgrid?: { apiKey?: string } }` (also the shape of `cfg.mail`)
  - `resolveMailSettings(input: { file: MailSettings | undefined; env: NodeJS.ProcessEnv; readFile?: (path: string) => string }): { settings: MailSettings; envManaged: string[] }`. `envManaged` holds dotted field names set by the environment, e.g. `"provider"`, `"smtp.password"`.
  - `mailReady(settings: MailSettings): boolean`: a provider, a `from`, and that provider's required fields are all present (SMTP needs `host`; SendGrid needs `apiKey`).
  - `publicMailStatus(resolved): { provider?: MailProvider; from?: string; smtp: { host?: string; port?: number; secure?: string; user?: string; passwordConfigured: boolean }; sendgrid: { apiKeyConfigured: boolean }; envManaged: string[]; ready: boolean }`. It never contains a secret.
  - `interface Mailer { send(message: { to: string; subject: string; text: string }): Promise<void> }`
  - `createMailer(settings: MailSettings, deps?: { fetchImpl?: typeof fetch; smtpTransport?: (options: object) => { sendMail(m: object): Promise<unknown> } }): Mailer | null`. Returns `null` when `!mailReady(settings)`.

- [ ] **Step 1: Write the failing tests**

`server/mail/mail-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mailReady, publicMailStatus, resolveMailSettings } from "./mail-config.ts";

describe("mail settings", () => {
  it("lets the environment win and reports which fields it manages", () => {
    const r = resolveMailSettings({
      file: { provider: "sendgrid", from: "web@example.com", sendgrid: { apiKey: "SG.file" } },
      env: { SAGAX_MAIL_PROVIDER: "smtp", SAGAX_SMTP_HOST: "smtp.example.com", SAGAX_SMTP_PORT: "587", SAGAX_SMTP_SECURE: "starttls", SAGAX_SMTP_PASSWORD: "pw" },
    });
    expect(r.settings.provider).toBe("smtp");
    expect(r.settings.from).toBe("web@example.com");
    expect(r.settings.smtp).toMatchObject({ host: "smtp.example.com", port: 587, secure: "starttls", password: "pw" });
    expect(r.envManaged.sort()).toEqual(["provider", "smtp.host", "smtp.password", "smtp.port", "smtp.secure"]);
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
  });

  it("never exposes a secret in the public status", () => {
    const status = publicMailStatus(resolveMailSettings({ file: { provider: "smtp", from: "a@b.c", smtp: { host: "h", password: "hunter2" }, sendgrid: { apiKey: "SG.secret" } }, env: {} }));
    const text = JSON.stringify(status);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("SG.secret");
    expect(status.smtp.passwordConfigured).toBe(true);
    expect(status.sendgrid.apiKeyConfigured).toBe(true);
  });
});
```

`server/mail/mailer.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createMailer } from "./mailer.ts";

describe("mailer", () => {
  it("is absent until mail is configured", () => {
    expect(createMailer({})).toBeNull();
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

  it("sends through SMTP with the chosen security", async () => {
    const sendMail = vi.fn(async () => ({}));
    const smtpTransport = vi.fn(() => ({ sendMail }));
    const mailer = createMailer({ provider: "smtp", from: "p@g.ca", smtp: { host: "smtp.g.ca", port: 587, secure: "starttls", user: "u", password: "pw" } }, { smtpTransport })!;
    await mailer.send({ to: "z@g.ca", subject: "s", text: "t" });
    expect(smtpTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.g.ca", port: 587, secure: false, requireTLS: true, auth: { user: "u", pass: "pw" } }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "p@g.ca", to: "z@g.ca", subject: "s", text: "t" }));
  });
});
```

- [ ] **Step 2: Run to verify they fail.** `npx vitest run server/mail/mail-config.test.ts server/mail/mailer.test.ts`
- [ ] **Step 3: Implement**
  - **`server/mail/mail-config.ts`:**
    - Env fields map to settings fields as follows: `SAGAX_MAIL_PROVIDER` → `provider` (only `smtp` | `sendgrid`; anything else is ignored), `SAGAX_MAIL_FROM` → `from`, `SAGAX_SMTP_HOST` → `smtp.host`, `SAGAX_SMTP_PORT` → `smtp.port` (integer 1-65535), `SAGAX_SMTP_SECURE` → `smtp.secure` (`tls` | `starttls` | `none`), `SAGAX_SMTP_USER` → `smtp.user`, `SAGAX_SMTP_PASSWORD` (or `_FILE`) → `smtp.password`, `SAGAX_SENDGRID_API_KEY` (or `_FILE`) → `sendgrid.apiKey`.
    - A `_FILE` value is read with `readFile` (default `fs.readFileSync(path, "utf8")`) and `.trim()`. An unreadable file is ignored with a `console.warn` that names the variable, never the content.
    - Start from a copy of `file`, apply each env field that is set and non-empty, and push its dotted name into `envManaged`.
    - `publicMailStatus` follows the Interfaces above. `mailReady` follows the test.
  - **`server/mail/mailer.ts`:**
    - **SendGrid:** POST `https://api.sendgrid.com/v3/mail/send` with headers `authorization: Bearer <key>` and `content-type: application/json`, and body `{ personalizations: [{ to: [{ email: to }] }], from: { email: from }, subject, content: [{ type: "text/plain", value: text }] }`. Any status other than 2xx throws `new Error(\`SendGrid refused the message (${status})\`)`.
    - **SMTP:** the default `smtpTransport` is `(o) => nodemailer.createTransport(o)`. Options: `{ host, port: port ?? (secure === "tls" ? 465 : 587), secure: secure === "tls", requireTLS: secure === "starttls", ignoreTLS: secure === "none", auth: user ? { user, pass: password ?? "" } : undefined }`. Call `sendMail({ from, to, subject, text })`. A failure throws `new Error(\`the mail server refused the message: ${error.message}\`)`; do not include the password.
- [ ] **Step 4: Run the tests (PASS), then `pnpm -s typecheck`.**
- [ ] **Step 5: Commit** `feat: send mail by SMTP or SendGrid, configured from the environment or settings`, followed by the Co-Authored-By line.

---

### Task 3: Connexion par courriel émise par le serveur

**Files:**
- Modify: `server/auth/account-signin.ts` (add `createServerEmailSignIn`), `server/index.ts` (construction at ~698, `/api/auth/email/start|verify` routes ~13964-13994, org invites ~wire at `createOrgRoutes`)
- Test: `server/auth/account-signin.test.ts` (append; create the file if it does not exist), `server/org/org-identity.e2e.test.ts` (append one case)

**Interfaces:**
- Consumes: `EmailOtpStore` (Task 1); `Mailer`, `createMailer`, `resolveMailSettings`, `mailReady` (Task 2); the existing `EmailSignIn` interface and `allowedScopes` in `account-signin.ts`.
- Produces: `createServerEmailSignIn(options: { allow: SignInAllowList | (() => SignInAllowList); otp: EmailOtpStore; mailer: () => Mailer | null; source?: () => string; appName?: string; publicUrl?: () => string | null }): EmailSignIn`.
  - `enabled()` is `signInEnabled(allow()) && mailer() !== null`.
  - `start(email)` checks the allow-list, issues a code and sends it: subject `Your Pulsa Bot sign-in code`, text `Your code is <code>. It expires in 10 minutes.` plus `Sign in at <publicUrl>/pair` when a public URL exists.
  - `verify` returns `{ ok: true, email, userId: "", scopes }`.
  - `start` needs the request's source for rate limiting. Widen the interface's `start` to `start(email: string, source?: string)`; the default source is `"unknown"`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { createServerEmailSignIn } from "./account-signin.ts";
import { EmailOtpStore } from "./email-otp.ts";

describe("server-issued email sign-in", () => {
  const allow = { admins: ["owner@example.com"], members: ["@example.com"] };
  it("is disabled until mail is configured", () => {
    expect(createServerEmailSignIn({ allow, otp: new EmailOtpStore(), mailer: () => null }).enabled()).toBe(false);
  });
  it("mails a code to a welcome address and signs it in with the right scopes", async () => {
    const send = vi.fn(async () => undefined);
    const otp = new EmailOtpStore({ random: () => "24681357" });
    const signIn = createServerEmailSignIn({ allow, otp, mailer: () => ({ send }), publicUrl: () => "https://sagax.example.com" });
    expect(signIn.enabled()).toBe(true);
    expect(await signIn.start("morgan@example.com", "src")).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "morgan@example.com", text: expect.stringContaining("24681357") }));
    expect(send.mock.calls[0]![0].text).toContain("https://sagax.example.com/pair");
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
```

For the last test: when sending fails, `start` voids the issued code. Call `otp.verify` with that code and discard the result, or add `otp.revoke(email)` to `EmailOtpStore`. If you add `revoke`, give it a unit test in `server/mail/email-otp.test.ts`.

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement**, then wire it in `server/index.ts`:
  - **Construction (~698):**
    - Build `const emailOtp = new EmailOtpStore();`.
    - Build `const mailResolved = () => resolveMailSettings({ file: cfg.mail, env: process.env });`.
    - Build `const mailer = () => createMailer(mailResolved().settings);`. Cache the mailer by a JSON key of the settings so a new transport is not built on every call.
    - Replace `createEmailSignIn({ allow: emailSignInAllowList })` with `createServerEmailSignIn({ allow: emailSignInAllowList, otp: emailOtp, mailer, publicUrl })`.
    - Keep `createEmailSignIn` exported and unused in index.ts; the desktop companion account service does not use it.
  - **`/api/auth/email/start`:** pass `requestSource(req)` as the source.
  - **`/api/auth/email/verify`:** already calls `principals.forAccount({ email, controlPlaneUserId })`. With `userId: ""`, make sure `controlPlaneUserId` is `undefined` (not `""`).
  - **Org invites:** after `issueInviteRoute` succeeds and `mailer()` is non-null, send the invite email:
    - subject: `You are invited to <org name> on Pulsa Bot`;
    - text: `<inviter> invited you. Sign in with this address at <publicUrl>/pair within 7 days.`
    - A send failure does not undo the invite. The route's JSON gains `mailed: boolean`.
  - **`AppConfig` (`server/config.ts`):** add `mail?: MailSettings` to the type and the Zod schema. It must round-trip through `saveConfig` (the save/patch logic belongs to Task 4).
- Append an e2e case to `server/org/org-identity.e2e.test.ts`: boot with `SAGAX_MAIL_PROVIDER=sendgrid`, `SAGAX_MAIL_FROM`, `SAGAX_SENDGRID_API_KEY`, and `SAGAX_SIGNIN_EMAILS=owner@example.com`. Stub `globalThis.fetch` for `api.sendgrid.com` if the harness runs in-process. If it runs as a child process, add a `mailer` test seam the harness can set, e.g. env `SAGAX_MAIL_CAPTURE_FILE` that writes messages to a file instead of sending; name it in the report. Then:
  - `POST /api/auth/email/start` for owner@example.com;
  - read the code from the captured message;
  - `POST /api/auth/email/verify`;
  - expect a session whose `principalId` is the local operator's principal (profile email owner@example.com).
- [ ] **Step 4:** Run `npx vitest run server/auth/account-signin.test.ts server/mail/email-otp.test.ts server/org/org-identity.e2e.test.ts server/org/org-routes.test.ts` and `pnpm -s typecheck`.
- [ ] **Step 5: Commit** `feat: sign in by email with codes this server sends`, followed by the Co-Authored-By line.

---

### Task 4: Réglages du courriel (API)

**Files:**
- Modify: `server/index.ts` (new routes near the other admin config routes; `configStatus` ~13208), `server/config.ts` (save path for `mail`)
- Test: `server/mail-settings.e2e.test.ts` (new, same harness pattern as `server/org/org-identity.e2e.test.ts`)

**Interfaces:**
- Produces (all admin-scope; a client session gets 403, per the existing admin route gating in `request-auth.ts`):
  - `GET /api/mail` returns `publicMailStatus(mailResolved())`.
  - `PUT /api/mail` takes a `MailSettings` body. Secrets are write-only: an absent `smtp.password` or `sendgrid.apiKey` keeps the stored value; an empty string clears it. If any field in the body is in `envManaged`, the whole request gets 409 `{ error: "managed by the server environment", fields }` and nothing is written. Otherwise the route saves `cfg.mail` through `saveConfig` and returns the new public status.
  - `POST /api/mail/test` takes `{ to?: string }` (default: the admin's own session email, else the profile email). It sends `Pulsa Bot test email` / `Mail from this server works.` and returns `{ ok: true }`, or `{ ok: false, error }` with status 502. Rate limit: 5 per 15 minutes per session.

- [ ] **Step 1: Write the failing e2e test**. It must check:
  - (a) with env `SAGAX_SMTP_HOST=smtp.env`, `GET /api/mail` shows `envManaged` containing `smtp.host` and no secret;
  - (b) `PUT` with `smtp.host` gets 409 and the config file is unchanged;
  - (c) `PUT` with `{ provider: "sendgrid", from: "p@g.ca", sendgrid: { apiKey: "SG.x" } }`, when not env-managed, gets 200. The response and a later GET contain `apiKeyConfigured: true` and never the text `SG.x`;
  - (d) a client-scope session gets 403 on all three routes;
  - (e) `POST /api/mail/test` with a failing transport returns 502 with an error that contains no secret. Use the Task 3 capture seam or a failing fetch.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** the routes and the config save. Add `mail` to whatever config-patch allowlist `saveConfig` uses. Do not add `mail` to the generic `/api/config` PATCH; the dedicated `PUT /api/mail` is the only writer. `configForAccess` must never include `cfg.mail`: grep it, and strip `mail` if the generic config GET would otherwise return it.
- [ ] **Step 4:** Run the e2e test and `pnpm -s typecheck`.
- [ ] **Step 5: Commit** `feat: manage the mail provider from settings, read-only where Docker sets it`, followed by the Co-Authored-By line.

---

### Task 5: Premier admin sans terminal

**Files:**
- Create: `server/first-admin.ts`
- Modify: `server/index.ts` (boot, after `sessions`, `principals` and `publicUrl()` exist, before `listen`)
- Test: `server/first-admin.test.ts`, plus one e2e case in `server/org/org-identity.e2e.test.ts`

**Interfaces:**
- Produces: `shouldIssueFirstAdminCode(input: { desktopManaged: boolean; liveSessions: number; admins: string[] }): boolean` and `firstAdminLine(input: { publicUrl: string | null; code: string; expiresAt: number }): string`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { firstAdminLine, shouldIssueFirstAdminCode } from "./first-admin.ts";

describe("first admin", () => {
  it("issues a code only on a fresh, served (not desktop) server", () => {
    expect(shouldIssueFirstAdminCode({ desktopManaged: false, liveSessions: 0, admins: [] })).toBe(true);
    expect(shouldIssueFirstAdminCode({ desktopManaged: true, liveSessions: 0, admins: [] })).toBe(false);
    expect(shouldIssueFirstAdminCode({ desktopManaged: false, liveSessions: 1, admins: [] })).toBe(false);
    expect(shouldIssueFirstAdminCode({ desktopManaged: false, liveSessions: 0, admins: ["owner@example.com"] })).toBe(false);
  });
  it("prints one line with the pairing link", () => {
    const line = firstAdminLine({ publicUrl: "http://localhost:8080", code: "ABCD-EFGH-JKLM", expiresAt: Date.UTC(2026, 8, 29, 12, 0) });
    expect(line.startsWith("[first-admin] ")).toBe(true);
    expect(line).toContain("http://localhost:8080/pair#code=ABCD-EFGH-JKLM");
    expect(line).not.toContain("\n");
  });
});
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement.**
  - `firstAdminLine` renders `[first-admin] Open <url>/pair#code=<code> to become this server's owner. The code expires at <ISO time>.`
  - When `publicUrl` is null, it renders `[first-admin] Pairing code <code> (open /pair on this server's address). The code expires at <ISO time>.`
  - In `index.ts` at boot:
    - if `shouldIssueFirstAdminCode({ desktopManaged: DESKTOP_MANAGED, liveSessions: sessions.list().length, admins: cfg.signIn?.admins ?? [] })`;
    - call `sessions.openPairing({ scopes: ["admin", "client"], label: "First admin", principalId: localPrincipalId(), ttlMs: 60 * 60_000 })`;
    - log `firstAdminLine(...)` with `console.log`, the code formatted with `formatPairingCode`.
- E2e: boot a fresh DATA_DIR as a served server, with `SAGAX_DESKTOP_PARENT` unset and the harness's stdout captured.
  - Find the `[first-admin]` line.
  - Exchange its code on `POST /api/pair`.
  - Expect a session with scopes including `admin` and `principalId` equal to the org-less local operator.
  - Restart the server: while that session is alive, no new `[first-admin]` line appears.
- [ ] **Step 4:** Run the tests and `pnpm -s typecheck`.
- [ ] **Step 5: Commit** `feat: print a first-admin pairing link on a fresh served server`, followed by the Co-Authored-By line.

---

### Task 6: Redémarrer le serveur et lire son journal

**Files:**
- Create: `server/log-buffer.ts`
- Modify: `server/index.ts` (install the buffer as early as possible at startup; routes; reuse `createGracefulShutdown`)
- Test: `server/log-buffer.test.ts`, `server/server-admin.e2e.test.ts`

**Interfaces:**
- Produces:
  - `class LogBuffer { constructor(max?: number, maxLine?: number); push(stream: "out" | "err", text: string): void; since(seq: number): { seq: number; lines: { seq: number; at: number; stream: "out" | "err"; text: string }[] } }`
  - `installLogCapture(buffer: LogBuffer, streams?: { stdout: NodeJS.WriteStream; stderr: NodeJS.WriteStream }): () => void`. It wraps `write` so the text still reaches the real stream, and returns an uninstall function.
  - Routes: `GET /api/server/status` returns `{ restartable: boolean, logs: boolean }`; it returns 404 when desktop-managed and is admin-only. `GET /api/server/logs?since=<seq>` returns `LogBuffer.since`, admin-only, and 404 when desktop-managed. `POST /api/server/restart` returns 202 `{ restarting: true }` and after 300 ms calls `process.kill(process.pid, "SIGTERM")`; it is admin-only and returns 404 when desktop-managed.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { LogBuffer } from "./log-buffer.ts";

describe("log buffer", () => {
  it("keeps the newest lines, split on newlines, with increasing seq", () => {
    const b = new LogBuffer(3, 50);
    b.push("out", "one\ntwo\n");
    b.push("err", "three\nfour");
    const all = b.since(0);
    expect(all.lines.map((l) => l.text)).toEqual(["two", "three", "four"]);
    expect(all.lines.map((l) => l.stream)).toEqual(["out", "err", "err"]);
    expect(b.since(all.seq).lines).toEqual([]);
  });
  it("cuts a very long line", () => {
    const b = new LogBuffer(10, 5);
    b.push("out", "abcdefghij");
    expect(b.since(0).lines[0]!.text).toBe("abcde…");
  });
});
```

`server/server-admin.e2e.test.ts`:
- an admin session gets `GET /api/server/status` → `{ restartable: true, logs: true }`;
- `GET /api/server/logs` contains a line the server printed at boot;
- a client session gets 403 on all three;
- with `SAGAX_DESKTOP_PARENT=1` all three return 404;
- `POST /api/server/restart` returns 202 and the child process exits with code 0 within 5 s. Only if the harness can observe the exit: spawn the server as a child and assert its exit.
- A secret must not reach the logs: set `SAGAX_SENDGRID_API_KEY=SG.canary` and assert no log line contains `SG.canary`. No code path should log it; this guards against a regression.

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement.**
  - `push` splits on `\n`, drops a trailing empty fragment, and cuts each line to `maxLine` characters followed by `…`. The ring keeps the last `max` lines. `seq` increments per line; `since(seq)` returns lines with `line.seq > seq` and the current max seq.
  - Install `installLogCapture` at the very top of the server's start-up (the first statements of index.ts that run at runtime), so boot lines are captured.
- [ ] **Step 4:** Run the tests and `pnpm -s typecheck`.
- [ ] **Step 5: Commit** `feat: restart the server and read its log from settings`, followed by the Co-Authored-By line.

---

### Task 7: Sections « Courriel » et « Serveur » dans les réglages

**Files:**
- Create: `src/components/MailSettings.tsx`, `src/components/ServerAdminSettings.tsx`
- Modify: `src/components/SettingsModal.tsx` (the `SECTIONS` array ~55-70 and the `section === …` render switch; the `AppSettingsSection` type), `src/state/store.tsx` if `AppSettingsSection` is defined there, `src/locales/en.json`, `src/locales/fr.json`
- Test: `src/components/MailSettings.test.ts`, `src/components/ServerAdminSettings.test.ts`

**Interfaces:**
- Consumes: `GET/PUT /api/mail`, `POST /api/mail/test`, `GET /api/server/status`, `GET /api/server/logs`, `POST /api/server/restart`.
- Produces:
  - Exported pure helpers for tests: `mailFormState(status)` maps the public status to form values plus a `locked: Set<string>` of env-managed fields. `mailPatchFromForm(form, status)` builds the PUT body, omitting locked fields and omitting untouched secret fields.
  - Components `MailSettings` and `ServerAdminSettings`.
- Behavior:
  - **Email section:**
    - a provider select (SMTP or SendGrid);
    - a sender address;
    - for SMTP: host, port, security select, user and password;
    - for SendGrid: an API key;
    - Save and « Send a test email » buttons.
  - Fields in `envManaged` render disabled with the note `t("mail.managedByDocker")`.
  - Secret inputs are empty password inputs whose placeholder shows `t("mail.secretSet")` when configured.
  - **Server section:** it is hidden when `GET /api/server/status` fails or returns 404. It has a « Restart server » button, which shows a confirm dialog, then an info line « Restarting… » and polls `/api/health` until it answers. It also has a log panel: monospace, 12px, last 500 lines, auto-refresh every 3 s while open, and a « Copy » button.
- Styles: follow the existing settings cards (`Card`, `SettingRow` from `SettingsPrimitives.tsx`, `ui-button`, `ui-button ui-button-primary`, input classes used in `SignInAccessCard.tsx`).
- Strings:

| key | en | fr |
|---|---|---|
| `settings.section.mail` | `Email` | `Courriel` |
| `settings.section.server` | `Server` | `Serveur` |
| `mail.provider` | `Provider` | `Fournisseur` |
| `mail.from` | `Sender address` | `Adresse d'expédition` |
| `mail.smtpHost` | `SMTP host` | `Hôte SMTP` |
| `mail.smtpPort` | `Port` | `Port` |
| `mail.smtpSecure` | `Security` | `Sécurité` |
| `mail.smtpUser` | `User name` | `Nom d'utilisateur` |
| `mail.smtpPassword` | `Password` | `Mot de passe` |
| `mail.sendgridKey` | `SendGrid API key` | `Clé API SendGrid` |
| `mail.managedByDocker` | `Set by the server's Docker configuration` | `Fixé par la configuration Docker du serveur` |
| `mail.secretSet` | `Saved (hidden)` | `Enregistré (masqué)` |
| `mail.save` | `Save` | `Enregistrer` |
| `mail.test` | `Send a test email` | `Envoyer un courriel de test` |
| `mail.testSent` | `Test email sent to {to}` | `Courriel de test envoyé à {to}` |
| `mail.notReady` | `Sign-in codes and invitations are not emailed until a provider is set.` | `Les codes de connexion et les invitations ne partent pas tant qu'aucun fournisseur n'est configuré.` |
| `server.restart` | `Restart server` | `Redémarrer le serveur` |
| `server.restartConfirm` | `Restart the server now? Everyone is disconnected for a few seconds.` | `Redémarrer le serveur maintenant? Tout le monde est déconnecté quelques secondes.` |
| `server.restarting` | `Restarting…` | `Redémarrage…` |
| `server.logs` | `Server log` | `Journal du serveur` |
| `server.copy` | `Copy` | `Copier` |

- [ ] **Step 1: Write failing tests** for `mailFormState` (locked set; secret configured → empty value with the set flag) and `mailPatchFromForm` (a locked field is never in the patch; an untouched secret is absent; a typed secret is present; a cleared secret is `""`). Add a render test with `renderToStaticMarkup`: a locked field renders `disabled` plus the managed note.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** Add the strings, then run `node scripts/generate-locale.mjs fr --accept`.
- [ ] **Step 4:** Run `npx vitest run src/components/MailSettings.test.ts src/components/ServerAdminSettings.test.ts src/components/SettingsModal*.test.ts`, `pnpm -s typecheck` and `pnpm -s i18n:check`.
- [ ] **Step 5: Commit** `feat: email and server sections in settings`, followed by the Co-Authored-By line.

---

### Task 8: Docker et README autour du web

**Files:**
- Modify: `compose.yaml` (the `omb.environment` block), `.env.example`, `deploy/local/README.md`
- Test: none (docs and config). Verify with `docker compose config` that the file parses (Docker is running on the operator's Mac).

**Changes:**
- **`compose.yaml`:** pass through, with empty defaults so that absent means unset: `SAGAX_MAIL_PROVIDER`, `SAGAX_MAIL_FROM`, `SAGAX_SMTP_HOST`, `SAGAX_SMTP_PORT`, `SAGAX_SMTP_SECURE`, `SAGAX_SMTP_USER`, `SAGAX_SMTP_PASSWORD`, `SAGAX_SMTP_PASSWORD_FILE`, `SAGAX_SENDGRID_API_KEY`, `SAGAX_SENDGRID_API_KEY_FILE`, `SAGAX_SIGNIN_EMAILS`, `SAGAX_SIGNIN_MEMBER_EMAILS`, each as `${VAR:-}`.
  - Check that an empty string counts as unset in `resolveMailSettings` (Task 2: « set and non-empty ») and in `config.ts` for `SAGAX_SIGNIN_*`. `loadConfig` treats `SAGAX_SIGNIN_EMAILS=""` as « set to empty », which would erase a list saved on the web. Fix it in `config.ts` so an empty value counts as unset, and add a unit test in the existing config tests.
- **`.env.example`:** the same variables, empty, with one comment line per group.
- **`deploy/local/README.md`:** rewrite around the web.
  1. Start: `docker compose up -d --build`.
  2. First admin: open Docker Desktop, go to the `pulsa-omb-1` container's Logs, copy the `[first-admin]` link, and open it. That makes you owner.
  3. Providers: Settings → Engines (« Sign in to Claude », « Connect ChatGPT ») and Settings → Connections (API keys).
  4. Email: Settings → Email, or the `.env` variables. Docker wins and shows as read-only.
  5. People: Settings → People, and the organization.
  6. Restart and logs: Settings → Server.
  7. Updating: `docker compose up -d --build` (host side).
  8. Exposure: bound to `127.0.0.1:8080`; put your proxy, tunnel or Tailscale Serve in front and set `SAGAX_PUBLIC_URL`.
  - Keep one short « CLI fallback » paragraph with the two old `docker compose exec` commands, for recovery only.
- **Commit** `docs: run the Docker server from the web`, followed by the Co-Authored-By line.
