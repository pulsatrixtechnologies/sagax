// @vitest-environment happy-dom
// Import an agent (Grok Bot, Claude Code, Hermes): the package is made in the app, then
// staged and imported through the bot import any bot creator may use; the
// preview says what arrives (inert) and what was left out.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const store = await importOriginal<typeof import("@/state/store")>();
  return { ...store, api: fixture.api, useStore: () => ({ state: store.initialState, dispatch: fixture.dispatch }) };
});

import { AgentImportPanel } from "./AgentImport";
import { readClaudeCodeFolder } from "@/lib/claude-code-folder";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = async () => { for (let i = 0; i < 4; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const click = (selector: string) => act(() => { (container.querySelector(selector) as HTMLElement).click(); });

function picked(path: string, text: string): File {
  const file = new File([text], path.split("/").pop()!);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

const STAGED = "11111111-2222-4333-8444-555555555555";
const legacyPreview = (name: string) => ({
  kind: "legacy", name, importName: name, includes: { identity: true, skills: 1, routines: 0 }, hasConversations: false, hasSharing: false,
  created: [{ part: "bot", detail: "1 bot(s) from an older Sagax package" }], skipped: [{ part: "format", detail: "An older package carries no memory." }], needsAction: [],
});

describe("import a Claude Code folder", () => {
  it("reads only the agent files, never a secret, and imports the bot inert", async () => {
    let uploaded = "";
    fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/bots/import/upload") {
        uploaded = await (init!.body as Blob).text();
        return { id: STAGED, preview: legacyPreview("acme-app") };
      }
      if (path === `/api/bots/import/${STAGED}`) return { botId: "new-bot", name: "acme-app", warnings: [], bot: { id: "new-bot", name: "acme-app" } };
      return {};
    });
    const onImported = vi.fn();
    act(() => { root.render(createElement(AgentImportPanel, { onImported })); });
    click("[data-agent-import-tab=claude]");
    const input = container.querySelector("[data-agent-import-folder]") as HTMLInputElement;
    expect(input.hasAttribute("webkitdirectory")).toBe(true);
    const envFile = picked("acme-app/.env", "API_KEY=sk-live-should-never-be-read");
    const envText = vi.spyOn(envFile, "text");
    Object.defineProperty(input, "files", { value: [
      picked("acme-app/CLAUDE.md", "Answer in French."),
      picked("acme-app/.claude/skills/notes/SKILL.md", "---\nname: notes\ndescription: Take notes\n---\n\nWrite notes."),
      picked("acme-app/.mcp.json", JSON.stringify({ mcpServers: { tracker: { type: "http", url: "https://mcp.example.com/mcp" } } })),
      envFile,
      picked("acme-app/src/app.ts", "export {}"),
    ], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(envText).not.toHaveBeenCalled();
    const document = JSON.parse(uploaded);
    expect(document.format).toBe("openmaus.package");
    expect(document.package.agents[0].soul).toBe("Answer in French.");
    expect(uploaded).not.toContain("sk-live");
    expect(uploaded).not.toContain("export {}");
    // our own summary, not the older-package lines
    expect(container.querySelector("[data-agent-import-summary]")?.textContent).toContain("1 skill(s), off until you turn them on");
    expect(container.querySelector("[data-agent-import-summary]")?.textContent).toContain("1 app(s) to connect yourself: tracker");
    expect(container.querySelector("[data-bot-zip-lines=skipped]")).toBeNull();
    expect(container.querySelector("[data-bot-zip-preview]")?.textContent).toContain("From Claude Code");
    expect(container.querySelector("[data-grok-left-out]")?.textContent).toContain(".env");
    click("[data-bot-zip-confirm]");
    await flush();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "select", id: "new-bot" });
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ botId: "new-bot" }));
  });

  it("says so when the folder has nothing to import, and stages nothing", async () => {
    act(() => { root.render(createElement(AgentImportPanel, { initialSource: "claude" })); });
    const input = container.querySelector("[data-agent-import-folder]") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [picked("site/README.md", "hello")], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("No CLAUDE.md");
    expect(fixture.api).not.toHaveBeenCalled();
  });
});

describe("import a Hermes agent", () => {
  it("reads the .hermes folder, never auth.json or .env, and imports the bots inert", async () => {
    let uploaded = "";
    fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/bots/import/upload") {
        uploaded = await (init!.body as Blob).text();
        return { id: STAGED, preview: legacyPreview("Hermes") };
      }
      return {};
    });
    act(() => { root.render(createElement(AgentImportPanel, {})); });
    click("[data-agent-import-tab=hermes]");
    expect(container.querySelector("[data-agent-import-claude=hermes]")?.textContent).toContain("SOUL.md");
    const input = container.querySelector("[data-agent-import-folder]") as HTMLInputElement;
    const auth = picked(".hermes/auth.json", "{\"token\":\"sk-live-should-never-be-read\"}");
    const authText = vi.spyOn(auth, "text");
    Object.defineProperty(input, "files", { value: [
      picked(".hermes/SOUL.md", "You are Atlas."),
      picked(".hermes/memories/USER.md", "Prefers French.\n§\nEastern time."),
      picked(".hermes/skills/ops/check/SKILL.md", "---\nname: check\ndescription: Check things\n---\n\nCheck."),
      picked(".hermes/cron/jobs.json", JSON.stringify({ jobs: [{ name: "Brief", prompt: "Brief me.", schedule: { kind: "cron", expr: "0 8 * * *" } }] })),
      picked(".hermes/profiles/coder/SOUL.md", "You write code."),
      picked(".hermes/profiles/coder/.env", "X=1"),
      picked(".hermes/state.db", "binary"),
      auth,
    ], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(authText).not.toHaveBeenCalled();
    const document = JSON.parse(uploaded);
    expect(document.package.agents.map((agent: { name: string }) => agent.name)).toEqual(["Hermes", "coder"]);
    expect(document.package.agents[0].seed.memory["MEMORY.md"]).toContain("- Prefers French.");
    expect(document.package.routines[0].enabledAfterInstall).toBe(false);
    expect(uploaded).not.toContain("sk-live");
    expect(uploaded).not.toContain("binary");
    expect(container.querySelector("[data-bot-zip-preview]")?.textContent).toContain("From Hermes");
    const leftOut = container.querySelector("[data-grok-left-out]")?.textContent ?? "";
    expect(leftOut).toContain("auth.json");
    expect(leftOut).toContain("profiles/coder/.env");
  });
});

describe("import a Grok Bot", () => {
  it("turns the pasted export into a package and stages it for the person", async () => {
    let uploaded = "";
    fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/bots/import/upload") {
        uploaded = await (init!.body as Blob).text();
        return { id: STAGED, preview: legacyPreview("Scout") };
      }
      return {};
    });
    act(() => { root.render(createElement(AgentImportPanel, {})); });
    const reply = JSON.stringify({
      format: "openmaus.grok/1", name: "Scout", description: "Finds leads.", instructions: "Find leads daily.",
      skills: [], routines: [{ name: "Daily", schedule: "every day at 9am", cron: "0 9 * * *", timeZone: "UTC", prompt: "Find leads." }],
      plugins: ["Gmail"], memories: [],
    });
    const box = container.querySelector("#grok-import-reply") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => { setter.call(box, reply); box.dispatchEvent(new Event("input", { bubbles: true })); });
    click("[data-grok-preview]");
    await flush();
    const document = JSON.parse(uploaded);
    expect(document.package.agents[0].name).toBe("Scout");
    expect(document.package.routines[0].enabledAfterInstall).toBe(false);
    expect(container.querySelector("[data-agent-import-summary]")?.textContent).toContain("1 routine(s), paused until you start them");
    expect(container.querySelector("[data-bot-zip-preview]")?.textContent).toContain("From Grok Bot");
  });
});

describe("left out in French", () => {
  it("shows the reasons in the person's language", async () => {
    const { setLocale } = await import("@/lib/i18n");
    setLocale("fr");
    try {
      fixture.api.mockResolvedValue({ id: STAGED, preview: legacyPreview("p") });
      act(() => { root.render(createElement(AgentImportPanel, { initialSource: "claude" })); });
      const input = container.querySelector("[data-agent-import-folder]") as HTMLInputElement;
      Object.defineProperty(input, "files", { value: [picked("p/CLAUDE.md", "Hi."), picked("p/.env", "x")], configurable: true });
      await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
      await flush();
      expect(container.querySelector("[data-grok-left-out]")?.textContent).toContain(".env : il peut contenir une clé ou un mot de passe");
    } finally {
      setLocale("en");
    }
  });
});

describe("readClaudeCodeFolder", () => {
  it("names secret files at the top or under .claude, and skips the rest of the tree", async () => {
    const folder = await readClaudeCodeFolder([
      picked("p/.env.local", "x"),
      picked("p/.claude/settings.local.json", "{}"),
      picked("p/node_modules/pkg/.env", "x"),
      picked("p/CLAUDE.md", "hi"),
    ]);
    expect(folder.folderName).toBe("p");
    expect(folder.skippedSecrets).toEqual([".env.local", ".claude/settings.local.json"]);
    expect(folder.files).toEqual([{ path: "CLAUDE.md", text: "hi" }]);
  });
});
