// The first asserted renderer recipe: docs/verification/chat-ui.md, run by a
// machine. It spawns the real `control-omb ui launch` (a child it can Ctrl-C),
// drives the real <App/> through the ui verbs, and reads the outcome back from
// the accessibility tree — the same evidence a person would collect by hand.
//
// Needs the pinned agent-browser binary. It runs when one resolves (the tools
// directory, SAGAX_AGENT_BROWSER_PATH or PATH) or when SAGAX_UI_E2E=1 asks for the
// verified download; otherwise it is skipped with a printed reason.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { resolveAgentBrowserBinary } from "../../server/browser/browser-engine.ts";
import { removeTempDir, waitForExit } from "../../server/testing/cleanup.ts";
import { runControlOmb } from "../control-omb.ts";
import { UI_TOOLS_DIR } from "./control-omb-ui.ts";
import { fixtureApi } from "./preview-fixture.ts";
import { openSettingsPageJs } from "./ui-click.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(ROOT, "scripts", "control-omb.ts");
const forced = process.env.SAGAX_UI_E2E === "1";
const binary = resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env });
const enabled = forced || Boolean(binary);
if (!enabled) {
  console.log(`skipping control-omb ui e2e: no agent-browser binary resolves (looked in ${UI_TOOLS_DIR}, SAGAX_AGENT_BROWSER_PATH and PATH); set SAGAX_UI_E2E=1 to install the pinned release`);
}
const run = enabled ? it : it.skip;
// A cold run downloads the binary and Chrome; a warm one launches in seconds.
// A forced run may still have Chrome for Testing to download (agent-browser can
// be cached while Chrome is not), so give every forced run the long budget.
const LAUNCH_TIMEOUT_MS = forced ? 600_000 : 180_000;

// Synthetic provider outcomes exercise the UI, not the commands themselves.
const TOOL_CALLS = JSON.stringify([
  { name: "Bash", input: { command: "pnpm control:omb doctor" }, ok: true },
  { name: "Bash", input: { command: "pnpm control:omb ui click --name Missing" }, ok: false },
  { name: "Bash", input: { command: "pnpm control:omb ui flag --set features.showToolCalls=true --dry-run" }, ok: true },
]);
const REPLY = "hello from fake claude"; // the fake engine's default reply text
const COMPOSER = `document.querySelector('textarea[aria-label="Message Pepper"]')`;
// SAGAX_UI_EVIDENCE_DIR keeps the screenshot (CI uploads it); otherwise it is temporary.
const evidenceDir = process.env.SAGAX_UI_EVIDENCE_DIR ? resolve(ROOT, process.env.SAGAX_UI_EVIDENCE_DIR) : mkdtempSync(join(tmpdir(), "omb-ui-evidence-"));
const ownsEvidenceDir = !process.env.SAGAX_UI_EVIDENCE_DIR;

interface Launched {
  child: ReturnType<typeof spawn>;
  info: { ui: string; url: string; previewUrl: string; botId: string; dataDir: string; logPath: string };
  stderr: () => string;
}

/** Start `ui launch` as a real foreground process and wait for its handle. */
function launch(args: string[]): Promise<Launched> {
  return new Promise((done, fail) => {
    // Own process group: a timeout must take the launch AND whatever it is
    // running (an `agent-browser install` mid-download) down with it.
    const child = spawn(process.execPath, ["--experimental-strip-types", CLI, "ui", "launch", ...args], {
      cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
    });
    const killGroup = (signal: NodeJS.Signals) => {
      if (child.pid && process.platform !== "win32") {
        try { process.kill(-child.pid, signal); return; } catch { /* group already gone */ }
      }
      child.kill(signal);
    };
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killGroup("SIGINT");
      setTimeout(() => killGroup("SIGKILL"), 10_000).unref();
      fail(new Error(`ui launch printed no handle within ${LAUNCH_TIMEOUT_MS}ms\nstderr:\n${stderr}`));
    }, LAUNCH_TIMEOUT_MS);
    child.stderr!.on("data", (chunk: Buffer) => { stderr += String(chunk); });
    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += String(chunk);
      if (settled) return;
      // The handle is the pretty-printed object at the start of a line; any
      // earlier line would be a tool printing on stdout, which the launch
      // is meant to prevent, so a parse from there still recovers.
      const start = stdout.startsWith("{") ? 0 : stdout.indexOf("\n{") + 1;
      if (start <= 0 && !stdout.startsWith("{")) return;
      try {
        const info = JSON.parse(stdout.slice(start));
        settled = true;
        clearTimeout(timer);
        done({ child, info, stderr: () => stderr });
      } catch {
        // the pretty-printed handle is still arriving
      }
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fail(new Error(`ui launch exited ${code} before printing a handle\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });
}

const ui = (verb: string, handle: string, ...args: string[]) =>
  runControlOmb(["ui", verb, "--ui", handle, ...args]) as Promise<Record<string, any>>;

/** Interactive refs by accessible name, from a snapshot's `refs` table. */
const refsNamed = (snapshot: Record<string, any>, name: string, role?: string) =>
  Object.entries(snapshot.refs as Record<string, { name: string; role: string }>)
    .filter(([, element]) => element.name === name && (!role || element.role === role))
    .map(([id]) => `@${id}`);

describe("control-omb ui drives the real renderer", () => {
  let launched: Launched | undefined;

  afterAll(async () => {
    if (launched && launched.child.exitCode === null && launched.child.signalCode === null) {
      await waitForExit(launched.child, { signal: "SIGINT", graceMs: 30_000 });
    }
    if (ownsEvidenceDir) await removeTempDir(evidenceDir);
  });

  run("shows the matched text inside a searched message", async () => {
    launched = await launch([]);
    const { info } = launched;
    await ui("type", info.ui, "--name", "Message Pepper", "--text", "Find the striped zebra");
    await ui("press", info.ui, "--keys", "Enter");
    await ui("wait-settle", info.ui, "--timeout", "60");
    await ui("eval", info.ui, "--js", `window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true })); true`);
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot, { timeout: 10_000 }).toContain("Find in this conversation");
    await ui("type", info.ui, "--name", "Find in this conversation", "--text", "zebra");
    const highlighted = async () => (await ui("eval", info.ui, "--js", "[...CSS.highlights.get('search-result-text') ?? []][0]?.toString() ?? null")).result;
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot, { timeout: 10_000 }).toContain("1 of 1");
    expect((await ui("snapshot", info.ui)).snapshot).not.toContain("Show less");
    mkdirSync(evidenceDir, { recursive: true });
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "search-result.png"));
    await expect.poll(async () => (await ui("eval", info.ui, "--js", "(() => { const row = [...document.querySelectorAll('[data-mid]')].find(el => el.textContent.includes('Find the striped zebra')); const bubble = row?.querySelector('[data-chat-bubble]'); return !!bubble && row.querySelector('.ring-2') === bubble && bubble.getBoundingClientRect().width < row.lastElementChild.getBoundingClientRect().width; })()")).result, { timeout: 10_000 }).toBe(true);
    await expect.poll(highlighted, { timeout: 10_000 }).toBe("zebra");
    await ui("type", info.ui, "--name", "Message Pepper", "--text", `${"hay ".repeat(160)}saffron`);
    await ui("press", info.ui, "--keys", "Enter");
    await ui("wait-settle", info.ui, "--timeout", "60");
    await ui("click", info.ui, "--name", "Find in this conversation");
    await ui("eval", info.ui, "--js", "document.querySelector('input[aria-label=\"Find in this conversation\"]').select(); true");
    await ui("press", info.ui, "--keys", "Backspace");
    await ui("type", info.ui, "--name", "Find in this conversation", "--text", "saffron");
    await expect.poll(highlighted, { timeout: 10_000 }).toBe("saffron");
    expect((await ui("eval", info.ui, "--js", "[...document.querySelectorAll('.chat-text')].find(el => el.textContent.includes('saffron'))?.classList.contains('max-h-40')")).result).toBe(false);
    await expect.poll(async () => (await ui("eval", info.ui, "--js", "(() => { const range = [...CSS.highlights.get('search-result-text')][0]; const bounds = range.startContainer.parentElement.closest('.overflow-y-auto').getBoundingClientRect(); const match = range.getBoundingClientRect(); return match.top >= bounds.top && match.bottom <= bounds.bottom; })()")).result).toBe(true);
    await ui("click", info.ui, "--name", "Find in this conversation");
    await ui("eval", info.ui, "--js", "document.querySelector('input[aria-label=\"Find in this conversation\"]').select(); true");
    await ui("press", info.ui, "--keys", "Backspace");
    await ui("type", info.ui, "--name", "Find in this conversation", "--text", "fake claude");
    await expect.poll(highlighted, { timeout: 10_000 }).toBe("fake claude");
    await ui("press", info.ui, "--keys", "Escape");
    await ui("click", info.ui, "--name", "Search bots and messages");
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot, { timeout: 10_000 }).toContain("Command palette");
    await ui("eval", info.ui, "--js", `(() => {
      const input = document.querySelector('[role="dialog"][aria-label="Command palette"] input');
      if (!(input instanceof HTMLInputElement)) throw new Error("palette input missing");
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "zebra");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return input.value;
    })()`);
    await expect.poll(async () => (await ui("eval", info.ui, "--js", "[...document.querySelectorAll('mark')].some(mark => mark.textContent === 'zebra')")).result, { timeout: 10_000 }).toBe(true);
    await ui("eval", info.ui, "--js", "[...document.querySelectorAll('mark')].find(mark => mark.textContent === 'zebra').closest('button').click(); true");
    await expect.poll(highlighted, { timeout: 10_000 }).toBe("zebra");
    await waitForExit(launched.child, { signal: "SIGINT", graceMs: 30_000 });
    expect(launched.child.exitCode).toBe(0);
  }, LAUNCH_TIMEOUT_MS + 90_000);

  run("saves a key on Enter, checks it once saved, and keeps a refused or failed draft", async () => {
    launched = await launch([]);
    const { info } = launched;
    await fixtureApi(info.url)("PUT", "/api/config", {
      openaiCompat: { key: "fixture-saved-key", url: "http://127.0.0.1:1/v1" },
    });
    const evaluate = async (js: string) => (await ui("eval", info.ui, "--js", js)).result;
    const click = (name: string) => ui("click", info.ui, "--name", name);
    const input = `document.querySelector('input[aria-label="OpenAI-compatible API key"]')`;
    const testButton = `[...${input}.closest('[data-api-key-row]').querySelectorAll('button')].find(b => b.textContent === 'Test')`;
    const verdict = () => evaluate(`${input}.closest('[data-api-key-row]').querySelector('[role="status"]')?.textContent`);
    const rowText = () => evaluate(`${input}.closest('[data-api-key-row]').textContent`);
    const type = async (text: string) => {
      await click("OpenAI-compatible API key");
      await evaluate(`${input}.select(); true`);
      await ui("press", info.ui, "--keys", "Backspace");
      if (text) await ui("type", info.ui, "--name", "OpenAI-compatible API key", "--text", text);
    };
    const enter = () => ui("press", info.ui, "--keys", "Enter");
    await evaluate(`(() => {
      const original = window.fetch.bind(window);
      window.keyTests = [];
      window.keySaves = 0;
      window.rejectKeySave = false;
      window.fetch = (url, init = {}) => {
        if (String(url) === '/api/keys/test') {
          window.keyTests.push(JSON.parse(init.body));
          return Promise.resolve(Response.json({ ok: true, check: 'models', models: ['fixture-model'] }));
        }
        if (String(url) === '/api/config' && init.method === 'PUT' && String(init.body).includes('"openaiCompat"')) {
          window.keySaves++;
          if (window.rejectKeySave) return Promise.resolve(Response.json({ error: 'Fixture save rejected' }, { status: 503 }));
        }
        return original(url, init);
      };
      return true;
    })()`);
    await click("You");
    await click("Settings");
    // Settings is its own chunk (src/components/lazy-screens.tsx): opened before
    // the idle prefetch has fetched it, it paints once the chunk arrives.
    await expect.poll(() => evaluate(`(() => {
      const tab = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Providers');
      tab?.click();
      return Boolean(tab);
    })()`), { timeout: 10_000 }).toBe(true);
    // The OpenAI-compatible key opens in its own dialog from the provider key list.
    await expect.poll(() => evaluate(`(() => { const b = document.querySelector('[data-provider-row$=":openaiCompat"] > button'); b?.click(); return Boolean(b); })()`), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => evaluate(`(() => { const b = document.querySelector('[data-provider-key-open="openaiCompat"]'); b?.click(); return Boolean(b); })()`), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => evaluate(`document.querySelector('[data-provider-key-dialog="openaiCompat"] [data-api-key-row="openaiCompat"]') !== null`), { timeout: 10_000 }).toBe(true);

    // A saved key with an untouched field can be checked again.
    await expect.poll(() => evaluate(`${testButton}?.disabled ?? null`), { timeout: 10_000 }).toBe(false);
    await click("Test");
    await expect.poll(() => evaluate("window.keyTests")).toEqual([{ provider: "openaiCompat" }]);
    await expect.poll(verdict).toBe("Saved key: Model catalog reachable: fixture-model. Authentication and chat not verified.");

    // Enter saves the trimmed draft, clears the field and checks the saved key.
    await type("  fixture-draft-key  ");
    await enter();
    await expect.poll(() => evaluate(`${input}?.value ?? null`), { timeout: 10_000 }).toBe("");
    await expect.poll(() => evaluate("window.keyTests")).toEqual([{ provider: "openaiCompat" }, { provider: "openaiCompat" }]);
    expect(await evaluate("window.keySaves")).toBe(1);

    // Pasted prose is refused before anything is saved.
    await type("not a key at all");
    await enter();
    await expect.poll(rowText, { timeout: 10_000 }).toContain("That doesn't look like an API key");
    expect(await evaluate("window.keySaves")).toBe(1);
    mkdirSync(evidenceDir, { recursive: true });
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "provider-key-refused.png"));

    // A failed save keeps the draft; a later success clears it and checks again.
    await type("fixture-replacement-key");
    await evaluate("window.rejectKeySave = true");
    await enter();
    await expect.poll(rowText, { timeout: 10_000 }).toContain("Fixture save rejected");
    await expect.poll(() => evaluate(`${input}?.value ?? null`), { timeout: 10_000 }).toBe("fixture-replacement-key");
    await evaluate("window.rejectKeySave = false");
    await click("OpenAI-compatible API key");
    await enter();
    await expect.poll(() => evaluate(`${input}?.value ?? null`), { timeout: 10_000 }).toBe("");
    await expect.poll(() => evaluate("window.keyTests.length")).toBe(3);
    await expect.poll(verdict).toBe("Saved key: Model catalog reachable: fixture-model. Authentication and chat not verified.");
    await waitForExit(launched.child, { signal: "SIGINT", graceMs: 30_000 });
    expect(launched.child.exitCode).toBe(0);
    expect(existsSync(info.dataDir)).toBe(false);
  }, LAUNCH_TIMEOUT_MS + 180_000);

  run("connects a named Azure-compatible provider in Settings and runs its model from the flat picker", async () => {
    const requests: Array<{ path: string; key?: string; model?: string }> = [];
    const upstream = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ path: req.url ?? "", key: req.headers.authorization, model: body.model });
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "azure-chat" }, { id: "azure-fast" }] }));
      if (req.url === "/v1/chat/completions") return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Azure-compatible fixture answered." }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3 } }));
      res.statusCode = 404; res.end("{}");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    try {
      launched = await launch([]);
      const { info } = launched;
      const evaluate = async (js: string) => (await ui("eval", info.ui, "--js", js)).result;
      await ui("click", info.ui, "--name", "You");
      await ui("click", info.ui, "--name", "Settings");
      await expect.poll(() => evaluate(openSettingsPageJs("Providers")), { timeout: 10_000 }).toBe(true);
      // The page and its add flow render after a click: wait for each control.
      const clickWhenShown = (selector: string) => expect.poll(() => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el?.click(); return Boolean(el); })()`), { timeout: 10_000 }).toBe(true);
      await clickWhenShown('[data-add-provider-open]');
      await clickWhenShown('[data-add-provider-way="server"]');
      const fill = async (selector: string, value: string) => {
        await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      };
      await expect.poll(() => evaluate(`Boolean(document.querySelector('[data-personal-provider-server]'))`)).toBe(true);
      await fill('[data-personal-provider-server] input:not([type])', "Azure Foundry");
      await fill('[data-personal-provider-server] input[type="url"]', `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`);
      await fill('[data-personal-provider-server] input[type="password"]', "fixture-personal-provider-key");
      await evaluate(`document.querySelector('[data-personal-provider-server] button[type="submit"]').click(); true`);
      const ownInstance = async () => {
        const response = await fetch(`${info.url}/api/instances`);
        const body = await response.json();
        return body.instances.find((instance: any) => instance.displayName === "Azure Foundry");
      };
      await expect.poll(async () => (await ownInstance())?.models.options.map((model: any) => model.id), { timeout: 20_000 }).toEqual(["azure-chat", "azure-fast"]);
      const instance = await ownInstance();
      await expect.poll(() => evaluate(`document.querySelector('[data-providers-page]').textContent`)).toContain("Azure Foundry");
      mkdirSync(evidenceDir, { recursive: true });
      await ui("screenshot", info.ui, "--out", join(evidenceDir, "azure-providers.png"));
      await expect.poll(() => evaluate(openSettingsPageJs("Models"))).toBe(true);
      await expect.poll(() => evaluate(`document.querySelector('[data-models-page]').textContent`)).toContain("azure-chat");
      await ui("screenshot", info.ui, "--out", join(evidenceDir, "azure-models.png"));
      await evaluate(`document.querySelector('[aria-label="Close settings"]').click(); true`);
      // #2106: the chat bar's model chip opens the model menu. Since #3116 it
      // has two steps: the harness (the server's own, "OpenAI-compatible"),
      // then that harness's models under the provider's name.
      await clickWhenShown('main [data-composer-actions] button[data-tour="model"]');
      await expect.poll(() => evaluate(`(() => {
        if (document.querySelector('[data-model-option="azure-chat"]')) return true;
        [...document.querySelectorAll('[data-model-menu] [data-model-harness]')].find((row) => (row.textContent || "").trim().startsWith("OpenAI-compatible"))?.click();
        return false;
      })()`), { timeout: 10_000 }).toBe(true);
      expect(await evaluate(`document.querySelector('[data-model-menu]').textContent`)).toContain("Azure Foundry");
      await evaluate(`document.querySelector('[data-model-option="azure-chat"]').scrollIntoView({ block: "center" }); true`);
      await ui("screenshot", info.ui, "--out", join(evidenceDir, "azure-model-picker.png"));
      await evaluate(`document.querySelector('[data-model-option="azure-chat"]').click(); true`);
      await expect.poll(async () => (await fixtureApi(info.url)("GET", "/api/bots")).bots.find((bot: any) => bot.id === info.botId).modelSelection).toMatchObject({ instanceId: instance.instanceId, model: "azure-chat" });
      const answered = async () => String(await evaluate(`document.body.textContent`)).includes("Azure-compatible fixture answered.");
      await ui("type", info.ui, "--name", "Message Pepper", "--text", "Say hello");
      await ui("press", info.ui, "--keys", "Enter");
      await ui("wait-settle", info.ui, "--timeout", "30");
      // #3718: the composer's warm finishing its own mount while this turn
      // mounts never stops the turn. A server that does not start in its
      // budget is skipped; the wait covers that budget on a busy host.
      await expect.poll(answered, { timeout: 90_000, interval: 1_000 }).toBe(true);
      expect(requests).toContainEqual({ path: "/v1/chat/completions", key: "Bearer fixture-personal-provider-key", model: "azure-chat" });
      await ui("screenshot", info.ui, "--out", join(evidenceDir, "azure-reply.png"));
      await waitForExit(launched.child, { signal: "SIGINT", graceMs: 30_000 });
      expect(launched.child.exitCode).toBe(0);
    } finally {
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  }, LAUNCH_TIMEOUT_MS + 180_000);

  run("sends a turn from the composer and shows the reply and the scripted tool chip", async () => {
    launched = await launch(["--tool-calls", TOOL_CALLS]);
    const { info } = launched;
    expect(info.ui).toBe(join(info.dataDir, "ui.json"));
    expect(existsSync(info.ui)).toBe(true);
    const handle = JSON.parse(readFileSync(info.ui, "utf8"));
    expect(handle).toMatchObject({ url: info.url, previewUrl: info.previewUrl, botId: info.botId, home: info.dataDir, session: `omb-ui-${new URL(info.url).port}` });
    expect(existsSync(handle.binary)).toBe(true);

    // The flag flips on the server; the renderer picks it up over SSE.
    const dry = await ui("flag", info.ui, "--set", "features.showToolCalls=true", "--dry-run");
    expect(dry).toMatchObject({ ok: true, dryRun: true, patch: { features: { showToolCalls: true } } });
    const flagged = await ui("flag", info.ui, "--set", "features.showToolCalls=true");
    expect(flagged).toMatchObject({ ok: true, features: { showToolCalls: true } });
    // Skill authoring is on by default, so the run card's Save as skill
    // needs no flag; the fixture's default config is what a fresh install has.
    expect(flagged.features).toMatchObject({ skillAuthoring: true });

    const savedBot = async () => (await fetch(`${info.url}/api/bots`).then((response) => response.json())).bots.find((bot: any) => bot.id === info.botId);
    const originalBot = await savedBot();

    // The chat paints after the launch returns: wait for its composer.
    await expect.poll(async () => (await ui("eval", info.ui, "--js", `String(Boolean(${COMPOSER}))`)).result, { timeout: 15_000 }).toBe("true");
    const before = await ui("snapshot", info.ui, "--interactive");
    expect(before.ok).toBe(true);
    const [composer, ...moreComposers] = refsNamed(before, "Message Pepper", "textbox");
    expect(composer).toMatch(/^@e\d+$/);
    expect(moreComposers).toEqual([]);
    expect(before.snapshot).not.toContain(REPLY);

    const typed = await ui("type", info.ui, "--ref", composer, "--text", "hello");
    expect(typed).toMatchObject({ ok: true, target: composer, typed: "hello" });
    const pressed = await ui("press", info.ui, "--keys", "Enter");
    expect(pressed).toMatchObject({ ok: true, pressed: "Enter" });

    // #3703: one send answers, even while the typing pre-warm relaunches
    // the engine.
    const settled = await ui("wait-settle", info.ui, "--timeout", "60");
    expect(settled).toMatchObject({ ok: true, status: "settled", browser: { state: "networkidle" }, renderer: { rendered: true } });
    expect((settled.bots as Array<{ busy: boolean }>).every((bot) => !bot.busy)).toBe(true);

    const after = await ui("snapshot", info.ui);
    expect(after.ok).toBe(true);
    const tree = after.snapshot as string;
    // The sidebar row previews the reply too; read the transcript landmark.
    const transcriptStart = tree.indexOf('log "Conversation with Pepper"');
    expect(transcriptStart).toBeGreaterThan(-1);
    const transcript = tree.slice(transcriptStart);
    expect(transcript).toContain('StaticText "hello"'); // the sent turn
    const helloRows = transcript.match(/StaticText "hello"/g)!.length;
    // (a) the fake engine's reply text, as a transcript row
    expect(transcript).toContain(`StaticText "${REPLY}"`);
    // (b) the scripted calls (Bash among them): the steps that worked fold
    // into one "Worked" row, the failed one stays outside it (#3633, #3581:
    // a failure is what the person needs to see), then "Used 3 tools"
    expect(transcript).toContain('button "Worked, 2 tools, press to see the detail"');
    expect(transcript).toContain('button "Could not run a command · Failed · Tool details"');
    expect(transcript).toMatch(/button "Used 3 tools/);
    expect(tree).not.toContain("Not logged in");
    expect(tree).not.toContain("Execution timeline");
    // The run card: the three scripted commands all go through the control
    // CLI, so all three are verified; one failed and one was a dry run.
    expect(tree).toContain("3 steps · 3 verified · 1 failed · 1 dry run");

    await ui("screenshot", info.ui, "--out", join(evidenceDir, "model-picked-fixture-turn.png"));
    // Hit-test the actual layout, not just the Tailwind class strings: the
    // blank band beside the floating card must reach the transcript while
    // the card and composer remain interactive.
    const hitTest = await ui("eval", info.ui, "--js", `(() => {
      const card = document.querySelector('section[aria-label="This run"]');
      const dock = card.closest("[data-run-overlay]");
      const rect = card.getBoundingClientRect();
      const blank = document.elementFromPoint(dock.getBoundingClientRect().left + 8, rect.top + rect.height / 2);
      const onCard = document.elementFromPoint(rect.left + 20, rect.top + 20);
      const scroll = document.querySelector('[role="log"]').parentElement;
      const composer = ${COMPOSER};
      const input = composer.getBoundingClientRect();
      return {
        blankReachesTranscript: scroll.contains(blank) && !dock.contains(blank) && getComputedStyle(scroll).overflowY === 'auto',
        cardInteractive: card.contains(onCard),
        composerInteractive: document.elementFromPoint(input.left + input.width / 2, input.top + input.height / 2) === composer,
      };
    })()`);
    expect(hitTest).toMatchObject({ result: { blankReachesTranscript: true, cardInteractive: true, composerInteractive: true } });

    // One mode (2026-10-09): a model chosen in the thread becomes the bot's
    // model; same-provider model changes preserve permissions. The models
    // are one dropdown.
    const originalModel = originalBot.modelSelection.model;
    const models = await runControlOmb(["models", "--url", info.url]) as any;
    const options = models.instances.find((instance: any) => instance.instanceId === originalBot.modelSelection.instanceId).models.options;
    const nextModel = options.find((option: any) => option.id !== originalModel);
    // #2106: the chat bar shows the model chip; a click on it opens the
    // model menu (ComposerActionBar.tsx, ModelPickerTrigger.tsx).
    const modelChip = "main [data-composer-actions] button[data-tour=\"model\"]";
    await expect.poll(async () => (await ui("eval", info.ui, "--js", `String(Boolean(document.querySelector(${JSON.stringify(modelChip)})))`)).result, { timeout: 10_000 }).toBe("true");
    await ui("eval", info.ui, "--js", `document.querySelector(${JSON.stringify(modelChip)}).click(); true`);
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "before-model-menu.png"));
    await expect.poll(async () => (await ui("eval", info.ui, "--js", "String(document.querySelector('[aria-label=\"Apply model changes to\"]') === null && Boolean(document.querySelector('[data-model-menu]')))")).result, { timeout: 10_000 }).toBe("true");
    const scopeShot = join(evidenceDir, "model-dropdown.png");
    mkdirSync(evidenceDir, { recursive: true });
    await ui("screenshot", info.ui, "--out", scopeShot);
    // Active models are immediately visible in the flat provider groups.
    await expect.poll(async () => (await ui("eval", info.ui, "--js", `Boolean(document.querySelector('[data-model-menu] [data-model-option="${nextModel.id}"]'))`)).result, { timeout: 10_000 }).toBe(true);
    await ui("eval", info.ui, "--js", `document.querySelector('[data-model-menu] [data-model-option="${nextModel.id}"]').click(); true`);
    await expect.poll(async () => (await savedBot()).modelSelection.model, { timeout: 10_000 }).toBe(nextModel.id);
    expect((await savedBot()).tasks.find((task: any) => task.threadId === originalBot.threadId).modelSelection.model).toBe(nextModel.id);
    expect((await savedBot()).approvalMode).toBe(originalBot.approvalMode);

    // These are real control operations: the fixture health check succeeds
    // and a deliberately missing UI target rejects instead of reporting green.
    expect(await runControlOmb(["doctor", "--url", info.url])).toMatchObject({ ok: true });
    await expect(ui("click", info.ui, "--name", "Deliberately missing QA control")).rejects.toThrow("no element is named");

    // A control the app paints after its data arrives must still be
    // clickable. Resolving --name used to take one snapshot, so a lookup
    // that landed a tick early failed as "no element is named" — the smoke's
    // own model row, and ~1 run in 8 red on four unrelated branches. The
    // button below is planted with the same delay the real one has.
    await ui("eval", info.ui, "--js", `(() => {
      const late = document.createElement("button");
      late.textContent = "Late QA control";
      late.setAttribute("aria-label", "Late QA control");
      // Keep this synthetic target inside the viewport: appending a normal
      // flow sibling below the full-height app makes click scroll the app
      // out of view, interfering with the real controls exercised next.
      late.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647';
      setTimeout(() => document.body.appendChild(late), 1500);
      return "planted";
    })()`);
    expect(await ui("click", info.ui, "--name", "Late QA control")).toMatchObject({ ok: true });
    await ui("eval", info.ui, "--js", `document.querySelector('[aria-label="Late QA control"]').remove()`);

    mkdirSync(evidenceDir, { recursive: true });
    const shotPath = join(evidenceDir, "chat-ui.png");
    const shot = await ui("screenshot", info.ui, "--out", shotPath);
    expect(shot).toMatchObject({ ok: true, path: shotPath });
    const png = readFileSync(shotPath);
    expect(png.length).toBeGreaterThan(1_000);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    // Save as skill fills the composer with the run — the trigger phrase (a
    // verified step is in it), the typed "hello" as the goal, and each step's
    // command tagged verified — for the person to annotate and send. It sends
    // nothing itself: the transcript is unchanged and the caret is in the box.
    const rowsBefore = await ui("eval", info.ui, "--js", "document.querySelectorAll('[data-mid]').length");
    await ui("click", info.ui, "--name", "Save as skill");
    const drafted = await ui("eval", info.ui, "--js", `${COMPOSER}.value`);
    expect(drafted.ok).toBe(true);
    const draft = drafted.result as string;
    expect(draft.startsWith("Create a verification skill from the run below.\nGoal: hello\n")).toBe(true);
    expect(draft).toContain("✓ doctor — pnpm control:omb doctor (verified)\n");
    expect(draft).toContain("✗ ui — pnpm control:omb ui click --name Missing (verified)\n");
    expect(draft).toContain("[dry run] ui — pnpm control:omb ui flag --set features.showToolCalls=true --dry-run (verified)\n");
    expect(draft.endsWith("\n\n")).toBe(true);
    expect(await ui("eval", info.ui, "--js", `document.activeElement === ${COMPOSER}`)).toMatchObject({ ok: true, result: true });
    // The composer sits inside the conversation landmark, so its draft shows up
    // in that snapshot; "nothing was sent" is the message-row count, unchanged.
    const rowsAfter = await ui("eval", info.ui, "--js", "document.querySelectorAll('[data-mid]').length");
    expect(rowsAfter.result).toBe(rowsBefore.result);
    const afterSave = await ui("snapshot", info.ui);
    const transcriptAfterSave = (afterSave.snapshot as string).slice((afterSave.snapshot as string).indexOf('log "Conversation with Pepper"'));
    expect(transcriptAfterSave.match(/StaticText "hello"/g)).toHaveLength(helloRows);

    await ui("click", info.ui, "--name", "Collapse the run");
    const collapsed = await ui("snapshot", info.ui);
    expect(collapsed.snapshot).toContain("Expand the run");
    expect(collapsed.snapshot).not.toContain('list "Run steps"');

    await ui("click", info.ui, "--name", "You");
    await ui("click", info.ui, "--name", "Settings");
    // The Inspector button's switch sits in Settings > Developer since
    // 0.8.64 (DeveloperSettings.tsx).
    await expect.poll(async () => (await ui("eval", info.ui, "--js", openSettingsPageJs("Developer"))).result, { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await ui("eval", info.ui, "--js", `Boolean(document.querySelector('[aria-label="Show the Inspector button"]'))`)).result, { timeout: 10_000 }).toBe(true);
    await ui("eval", info.ui, "--js", `(() => {
      const sw = document.querySelector('[aria-label="Show the Inspector button"]');
      if (!sw) throw new Error("Show the Inspector button is missing");
      if (sw.getAttribute("aria-checked") !== "true") sw.click();
      return true;
    })()`);
    await ui("click", info.ui, "--name", "Close settings");
    // The Inspector is an item of the conversation's "More options" menu. The
    // settings window is still closing on the first tries: open until it shows.
    await expect.poll(async () => (await ui("eval", info.ui, "--js", `(() => {
      if (document.querySelector('[data-conversation-inspector]')) return true;
      const more = document.querySelector('main button[aria-label="More options"]');
      if (more && more.getAttribute("aria-expanded") !== "true") more.click();
      return false;
    })()`)).result, { timeout: 10_000 }).toBe(true);
    await ui("eval", info.ui, "--js", "document.querySelector('[data-conversation-inspector]').click(); true");
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot, { timeout: 10_000 }).toContain('complementary "Inspector"');
    const inspected = await ui("snapshot", info.ui);
    const runLog = (inspected.snapshot as string).slice((inspected.snapshot as string).indexOf('complementary "Inspector"'));
    expect(runLog).toContain('tab "Run log" [selected');
    expect(runLog).toContain("pnpm control:omb doctor");
    expect(runLog).toContain("pnpm control:omb ui click --name Missing");
    expect(runLog).toContain('StaticText "Failed"');
    expect(runLog).toContain("Copy redacted run log");
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "run-log.png"));

    // Existing technical views remain reachable by accessible tab references.
    // The Inspector slides in: a click during the slide can miss, so retry by
    // a fresh reference until the tab is selected.
    const selectTab = (name: string) => expect.poll(async () => {
      const current = await ui("snapshot", info.ui);
      if ((current.snapshot as string).includes(`tab "${name}" [selected`)) return true;
      const [ref] = refsNamed(current, name, "tab");
      expect(ref).toBeDefined();
      await ui("click", info.ui, "--ref", ref);
      return false;
    }, { timeout: 10_000 }).toBe(true);
    await selectTab("Events");
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot, { timeout: 10_000 }).toContain("turn.started");
    await selectTab("Raw");
    await ui("click", info.ui, "--name", "Close the Inspector");
    expect((await ui("snapshot", info.ui)).snapshot).not.toContain('complementary "Inspector"');

    const logs = await ui("console", info.ui);
    expect(logs.ok).toBe(true);
    expect((logs.messages as Array<{ type: string; text: string }>).filter((message) => message.type === "error")).toEqual([]);
    const title = await ui("eval", info.ui, "--js", "document.title");
    expect(title).toMatchObject({ ok: true, result: "Isolated Sagax Chat" });

    // Ctrl-C: browser, preview and fixture close; only the fixture's data goes.
    await waitForExit(launched.child, { signal: "SIGINT", graceMs: 30_000 });
    expect(launched.child.exitCode).toBe(0);
    expect(existsSync(info.dataDir)).toBe(false);
    expect(existsSync(info.logPath)).toBe(true);
    await expect(ui("snapshot", info.ui)).rejects.toThrow("could not read the ui handle");
  }, LAUNCH_TIMEOUT_MS + 120_000);
});
