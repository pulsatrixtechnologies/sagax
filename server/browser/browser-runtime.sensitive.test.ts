import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SENSITIVE_FIELD_MARKER } from "../../shared/sensitive-fields.ts";
import { BROWSER_CONTROL_REFUSAL, BrowserRuntime, type BrowserSpawnSpec } from "./browser-runtime.ts";
import { SecretRedactor } from "../vault/credential-fill.ts";

// Every value below is fake test data.
const TYPED_PASSWORD = "fake-Person-Typed-Pa55";
const CARD = "4111 1111 1111 1111";
const PAGE = '<form method="post" action="/session"><input id="user" type="email" autocomplete="username"><input id="pass" type="password"><input id="card" autocomplete="cc-number"><input id="csc" autocomplete="cc-csc"><input id="search" type="text" name="q"></form><p>Welcome back</p>';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

// A fake agent-browser engine whose page is a happy-dom document. Its
// snapshot shows every input's value, the way an accessibility tree can;
// eval runs in the page; get_text returns the inputs' values too. What the
// person types through the live view while they hold the browser reaches the
// page from PERSON_FILE (the live view drives the engine directly, never
// through a bot's call). A screenshot answers which fields were masked at
// that moment. STATE_FILE receives the page's values and masks after each call.
const FAKE_ENGINE = String.raw`
const lines = require('node:readline').createInterface({ input: process.stdin });
const fs = require('node:fs');
const { Window } = require('happy-dom');
const win = new Window({ url: process.env.PAGE_URL, settings: { disableIframePageLoading: true } });
win.document.body.innerHTML = process.env.PAGE_HTML;
const inputs = () => Array.from(win.document.querySelectorAll('input'));
const values = () => Object.fromEntries(inputs().map((el) => [el.id, el.value]));
const masked = () => inputs().filter((el) => el.hasAttribute('data-sagax-masked')).map((el) => el.id);
const text = (value) => ({ content: [{ type: 'text', text: value }] });
const personTypes = () => {
  if (!fs.existsSync(process.env.PERSON_FILE)) return;
  const typed = JSON.parse(fs.readFileSync(process.env.PERSON_FILE, 'utf8'));
  fs.rmSync(process.env.PERSON_FILE);
  for (const [id, value] of Object.entries(typed)) win.document.getElementById(id).value = value;
};
lines.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'notifications/initialized') return;
  personTypes();
  let result;
  if (m.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} } };
  else if (m.method === 'tools/list') result = { tools: [{ name: 'agent_browser_snapshot' }] };
  else {
    const { name, arguments: args } = m.params;
    if (name === 'agent_browser_get_url') result = text(process.env.PAGE_URL);
    else if (name === 'agent_browser_eval') { try { result = text(JSON.stringify(win.eval(args.script))); } catch (error) { result = { isError: true, content: [{ type: 'text', text: 'Evaluation failed: ' + error.message }] }; } }
    else if (name === 'agent_browser_snapshot') result = text(inputs().map((el) => 'textbox #' + el.id + ' value="' + el.value + '"').join('\n'));
    else if (name === 'agent_browser_get_text') result = text(win.document.body.textContent + ' ' + Object.values(values()).join(' '));
    else if (name === 'agent_browser_fill') { win.document.querySelector(args.selector).value = args.text; result = text('filled'); }
    else if (name === 'agent_browser_screenshot') result = { content: [{ type: 'image', data: Buffer.from(JSON.stringify(masked())).toString('base64'), mimeType: 'image/png' }] };
    else result = text('unknown ' + name);
  }
  fs.writeFileSync(process.env.STATE_FILE, JSON.stringify({ values: values(), masked: masked() }));
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n');
});
`;

function engine(): { spec: BrowserSpawnSpec; personTypes: (typed: Record<string, string>) => void; values: () => Record<string, string>; masked: () => string[] } {
  const dir = mkdtempSync(join(tmpdir(), "sagax-sensitive-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const state = join(dir, "state.json");
  const person = join(dir, "person.json");
  const read = () => existsSync(state) ? JSON.parse(readFileSync(state, "utf8")) as { values: Record<string, string>; masked: string[] } : { values: {}, masked: [] };
  return {
    spec: { command: process.execPath, args: ["-e", FAKE_ENGINE], env: {
      PATH: process.env.PATH, PAGE_URL: "https://shop.example.test/checkout", PAGE_HTML: PAGE, STATE_FILE: state, PERSON_FILE: person, NODE_PATH: join(process.cwd(), "node_modules"),
    } },
    personTypes: (typed) => writeFileSync(person, JSON.stringify(typed)),
    values: () => read().values,
    masked: () => read().masked,
  };
}

function runtime(): BrowserRuntime {
  const value = new BrowserRuntime({ requestTimeoutMs: 5_000, takeoverTimeoutMs: 100, idleMs: 5_000 });
  cleanups.push(() => value.closeAll());
  return value;
}

type ToolResult = { isError?: boolean; content: Array<{ type: string; text?: string; data?: string }> };
const call = (browser: BrowserRuntime, spec: BrowserSpawnSpec, name: string, args: Record<string, unknown> = {}) =>
  browser.agentRpc("s", spec, "tools/call", { name, arguments: args }) as Promise<ToolResult>;

describe("sensitive fields in the bot's browser", () => {
  it("the person takes control, types a password, hands back: the next snapshot never shows it, the page keeps it", async () => {
    const browser = runtime();
    const page = engine();
    expect((await call(browser, page.spec, "agent_browser_snapshot")).content[0]!.text).toContain('#pass value=""');
    await browser.take("s", "person");
    await expect(call(browser, page.spec, "agent_browser_snapshot")).rejects.toThrow(BROWSER_CONTROL_REFUSAL);
    page.personTypes({ user: "ada.fake@example.test", pass: TYPED_PASSWORD, card: CARD, csc: "321", search: "running shoes" });
    browser.release("s", "person");
    const snapshot = await call(browser, page.spec, "agent_browser_snapshot");
    const text = snapshot.content[0]!.text!;
    expect(JSON.stringify(snapshot)).not.toContain(TYPED_PASSWORD);
    expect(JSON.stringify(snapshot)).not.toContain(CARD);
    expect(text).toContain(`#pass value="${SENSITIVE_FIELD_MARKER}"`);
    expect(text).toContain(`#card value="${SENSITIVE_FIELD_MARKER}"`);
    expect(text).toContain(`#csc value="${SENSITIVE_FIELD_MARKER}"`);
    // What is not sensitive stays readable.
    expect(text).toContain('#user value="ada.fake@example.test"');
    expect(text).toContain('#search value="running shoes"');
    // The page keeps the real values: the form still submits them.
    expect(page.values()).toMatchObject({ pass: TYPED_PASSWORD, card: CARD, csc: "321" });
    // Every other read of the page, and the bot's own script, too.
    for (const result of [
      await call(browser, page.spec, "agent_browser_get_text"),
      await call(browser, page.spec, "agent_browser_eval", { script: "document.querySelector('#pass').value + '|' + document.querySelector('#card').value" }),
    ]) {
      expect(JSON.stringify(result)).not.toContain(TYPED_PASSWORD);
      expect(JSON.stringify(result)).not.toContain(CARD);
      expect(JSON.stringify(result)).toContain(SENSITIVE_FIELD_MARKER);
    }
    expect(page.values().pass).toBe(TYPED_PASSWORD);
  });

  it("a value the bot fills into a password field is hidden from later reads too", async () => {
    const browser = runtime();
    const page = engine();
    await call(browser, page.spec, "agent_browser_fill", { selector: "#pass", text: "fake-Bot-Chosen-Pa55" });
    const snapshot = await call(browser, page.spec, "agent_browser_snapshot");
    expect(JSON.stringify(snapshot)).not.toContain("fake-Bot-Chosen-Pa55");
    expect(page.values().pass).toBe("fake-Bot-Chosen-Pa55");
  });

  it("a screenshot is taken with sensitive fields masked, then the page is as it was", async () => {
    const browser = runtime();
    const page = engine();
    page.personTypes({ pass: TYPED_PASSWORD, card: CARD });
    const shot = await call(browser, page.spec, "agent_browser_screenshot");
    expect(shot.isError).toBeUndefined();
    const image = shot.content.find((part) => part.type === "image")!;
    const maskedAtCapture = JSON.parse(Buffer.from(image.data!, "base64").toString("utf8")) as string[];
    expect(maskedAtCapture).toEqual(expect.arrayContaining(["pass", "card", "csc"]));
    expect(maskedAtCapture).not.toContain("search");
    expect(maskedAtCapture).not.toContain("user");
    expect(page.masked()).toEqual([]);
    expect(page.values()).toMatchObject({ pass: TYPED_PASSWORD, card: CARD });
  });
});

describe("the redactor's sensitive-field values", () => {
  it("replaces them with the marker, a long one with its pieces, a short one whole", () => {
    const redactor = new SecretRedactor();
    redactor.rememberSensitive("s", TYPED_PASSWORD);
    redactor.rememberSensitive("s", "987");
    const text = redactor.redactText("s", `textbox "Password": ${TYPED_PASSWORD} / ${TYPED_PASSWORD.slice(0, 12)} / code 987 / 9870 items`);
    expect(text).not.toContain(TYPED_PASSWORD.slice(0, 12));
    expect(text).toContain(`textbox "Password": ${SENSITIVE_FIELD_MARKER}`);
    expect(text).toContain(`code ${SENSITIVE_FIELD_MARKER}`);
    expect(text).toContain("9870 items");
  });

  it("a short value expires once no longer seen; a vault value keeps its own marker", () => {
    let now = 0;
    const redactor = new SecretRedactor(() => now);
    redactor.remember("s", "fake-vault-secret-1", { pieces: true });
    redactor.rememberSensitive("s", "fake-vault-secret-1");
    redactor.rememberSensitive("s", "4321");
    expect(redactor.redactText("s", "fake-vault-secret-1 4321")).toBe(`[credential] ${SENSITIVE_FIELD_MARKER}`);
    now += 6 * 60_000;
    expect(redactor.redactText("s", "fake-vault-secret-1 4321")).toBe("[credential] 4321");
    redactor.forget("s");
    expect(redactor.redactText("s", "fake-vault-secret-1")).toBe("fake-vault-secret-1");
  });
});
