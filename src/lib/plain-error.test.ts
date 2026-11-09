import { afterEach, describe, expect, it } from "vitest";
import { isTechnicalError, isTransientFailure, plainErrorLine, readableError, retryTransient } from "./plain-error";
import { setLocale } from "./i18n";
import { providerReplyCutMessage } from "../../shared/provider-reply-cut";
import { requestTooLargeMessage } from "../../shared/request-too-large";
import { botsSaveFailure } from "../../shared/bots-save-failure";

describe("plainErrorLine: an engine that stopped before replying (#3008)", () => {
  afterEach(() => setLocale("en"));
  const raw = "pi process exited before replying: Error: spawn npm ENOENT npm install pi-subagents --prefix /data/principals/p/piAgent-key/npm --legacy-peer-deps";

  it("says the engine stopped, never \"couldn't be found\" from the ENOENT in the raw text", () => {
    expect(plainErrorLine(raw)).toBe("The bot's engine stopped before it could reply. Send your message again; if it keeps happening, restart the engine.");
    expect(plainErrorLine("claude process exited before replying")).toBe(plainErrorLine(raw));
  });

  it("reads in French", () => {
    setLocale("fr");
    expect(plainErrorLine(raw)).toBe("Le moteur du bot s'est arrêté avant de répondre. Renvoie ton message ; si ça se répète, redémarre le moteur.");
  });
});

describe("plainErrorLine", () => {
  it.each([
    ["Failed to fetch", "Couldn't reach Sagax. Check that it's running, then try again."],
    ["NetworkError when attempting to fetch resource.", "Couldn't reach Sagax. Check that it's running, then try again."],
    ["The operation was aborted due to timeout", "That took too long. Try again."],
    ["502 Bad Gateway", "Something went wrong on the other end. Try again."],
    ["500 Internal Server Error", "Something went wrong on the other end. Try again."],
    ["404 Not Found", "That couldn't be found. It may have been removed."],
    ["413 Payload Too Large", "That's too large to send."],
    ["429 Too Many Requests", "Too many requests right now. Wait a moment, then try again."],
    ['API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', "The service is busy right now. Try again in a moment."],
    ["API Error: 529 Overloaded. This is a server-side issue, usually temporary.", "Overloaded. This is a server-side issue, usually temporary."],
    ["API Error: 400 Claude Code 2.1.268 does not support this model; version 2.1.280 or newer is required.", "Claude Code 2.1.268 does not support this model; version 2.1.280 or newer is required."],
    ["OpenRouter HTTP 404: model qwen-9 not found", "model qwen-9 not found"],
    ["HTTP 503", "The service is busy right now. Try again in a moment."],
    ["HTTP 502 Bad Gateway", "Something went wrong on the other end. Try again."],
    ["upstream HTTP 503 Service Unavailable", "The service is busy right now. Try again in a moment."],
    ["EACCES: permission denied, open '/Users/sam/notes.md'", "This computer didn't allow that. Check the file or folder permissions, then try again."],
    ["upstream HTTP 401: {\"error\":{\"message\":\"invalid x-api-key\"}}", "Access was refused. Check the sign-in, then try again."],
    ["read ECONNRESET", "The connection dropped. Try again."],
    ["TypeError: Cannot read properties of undefined (reading 'id')", "Something went wrong. Try again."],
    ["Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON", "Something went wrong. Try again."],
    ["claude exited 3 before result: fake-claude: simulated crash before result", "Something went wrong. Try again."],
    ["rate_limited", "Too many requests right now. Wait a moment, then try again."],
    ["Error\n    at fetchBots (store.tsx:12:3)", "Something went wrong. Try again."],
  ])("reads %j as a plain line", (raw, line) => {
    expect(plainErrorLine(raw)).toBe(line);
  });

  it.each([
    "Clipboard has no image",
    "Add your key in Settings → API keys",
    "Not logged in · Please run /login",
    "rate limited",
    "Your Pro plan includes 2 cloud computers at once. Delete one to start another.",
    "ChatGPT plan usage limit reached (subscription_sharing_usage_limit_exceeded)",
    "no activity for 10 minutes — the turn was stopped",
    "The server returned HTTP 503. Wait for the scheduled maintenance to finish, then try again.",
    "Couldn't undo that change.",
    botsSaveFailure("the thread switch", "EPERM"),
    botsSaveFailure("the thread's usage", "ENOSPC"),
    "",
  ])("keeps a sentence a person can read: %j", (raw) => {
    expect(isTechnicalError(raw)).toBe(false);
    expect(plainErrorLine(raw)).toBeUndefined();
  });
});

describe("a provider refusing a message as too large", () => {
  afterEach(() => setLocale("en"));

  it("is said in the reader's language with the model's name", () => {
    const cause = requestTooLargeMessage("GLM 5.3 Flash");
    expect(plainErrorLine(cause)).toBe(cause);
    setLocale("fr");
    expect(plainErrorLine(`  ${requestTooLargeMessage("vendor/model-1.5")}\n`)).toBe("Ce message est trop volumineux pour vendor/model-1.5. Commence une nouvelle conversation ou choisis un modèle qui en accepte davantage.");
    expect(plainErrorLine("This message is too large for the box.")).toBeUndefined();
  });
});

describe("a provider cutting a reply short", () => {
  afterEach(() => setLocale("en"));

  it("says length and content_filter cuts in the reader's language, including the old technical line", () => {
    expect(plainErrorLine(providerReplyCutMessage("length"))).toBe(
      "The reply was cut: maximum length reached. Ask for a continuation.",
    );
    expect(plainErrorLine(providerReplyCutMessage("content_filter"))).toBe(
      "The reply was cut by the provider: content filter.",
    );
    expect(plainErrorLine("provider did not finish the response (content_filter)")).toBe(
      "The reply was cut by the provider: content filter.",
    );
    setLocale("fr");
    expect(plainErrorLine(providerReplyCutMessage("length"))).toBe(
      "Réponse coupée : longueur maximale atteinte. Demande une suite.",
    );
    expect(plainErrorLine(providerReplyCutMessage("content_filter"))).toBe(
      "Réponse coupée par le fournisseur : filtre de contenu.",
    );
    expect(plainErrorLine("provider did not finish the response (length)")).toBe(
      "Réponse coupée : longueur maximale atteinte. Demande une suite.",
    );
    expect(plainErrorLine(providerReplyCutMessage("length"))).not.toMatch(/—|–/);
  });
});

describe("readableError", () => {
  it("never shows a proxy's bare status, and keeps a sentence someone wrote", () => {
    const proxy = Object.assign(new Error("502 Bad Gateway"), { status: 502 });
    expect(readableError(proxy)).toBe("Something went wrong on the other end. Try again.");
    expect(readableError(proxy)).not.toMatch(/502|Bad Gateway/);
    expect(readableError(new Error("GitHub refused this token."))).toBe("GitHub refused this token.");
  });

  it("knows a failure a moment fixes: a restart behind the proxy, or no answer at all", () => {
    expect(isTransientFailure(Object.assign(new Error("502 Bad Gateway"), { status: 502 }))).toBe(true);
    expect(isTransientFailure(Object.assign(new Error("x"), { status: 504 }))).toBe(true);
    expect(isTransientFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransientFailure(Object.assign(new Error("GitHub refused this token."), { status: 400 }))).toBe(false);
    expect(isTransientFailure(Object.assign(new Error("not here"), { status: 404 }))).toBe(false);
  });
});

describe("retryTransient", () => {
  it("asks again while the server restarts, and stops at the first real answer", async () => {
    let calls = 0;
    const answer = await retryTransient(async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("502 Bad Gateway"), { status: 502 });
      return "ok";
    }, [0, 0, 0]);
    expect(answer).toBe("ok");
    expect(calls).toBe(3);
    let refused = 0;
    await expect(retryTransient(async () => { refused += 1; throw Object.assign(new Error("No."), { status: 403 }); }, [0, 0])).rejects.toThrow("No.");
    expect(refused).toBe(1);
  });
});
