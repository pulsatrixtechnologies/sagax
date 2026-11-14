import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { ToolActivity } from "./ToolActivity";
import { BotEditorStore } from "@/state/store";
import { MCP_CREDENTIALS_REFUSED } from "../../shared/connector-refusal";

const store = { dispatch: () => {} } as unknown as Parameters<typeof BotEditorStore>[0]["value"];
const inStore = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(BotEditorStore, { value: store, children: el }));

describe("ToolActivity", () => {
  it("is a quiet step row: plain words, no frame, no monospace, no green check", () => {
    const html = renderToStaticMarkup(createElement(ToolActivity, { tool: { name: "Bash", ok: true, input: "{\"command\":\"echo hi\"}", durationMs: 2_100 } }));
    expect(html).toContain("data-step-row");
    expect(html).toContain('data-phase="done"');
    expect(html).toContain(">Ran a command<");
    expect(html).toContain(">echo hi<");
    expect(html).toContain(">2s<");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Ran a command · Completed · Tool details");
    // the old pill: a bordered chip with the raw id in monospace and a green check
    expect(html).not.toContain("border border-hairline");
    expect(html).not.toContain("font-mono");
    expect(html).not.toContain("text-success");
    // collapsed: the detail is not drawn
    expect(html).not.toContain("tool-step-detail");
  });

  it("opens to the technical name, readable arguments and an escaped result", () => {
    const html = renderToStaticMarkup(createElement(ToolActivity, {
      tool: { name: "mcp__agents__coordinate_bots", ok: true, input: JSON.stringify({ bot_ids: ["b1"], message: "check the logs" }), output: "<script>unsafe()</script>" },
      nameOf: (id: string) => (id === "b1" ? "Wren" : undefined),
      defaultOpen: true,
    }));
    expect(html).toContain(">Coordinated Wren<");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("tool-step-detail");
    // 2026-11-02: the detail names the tool in words; the raw id is only in
    // the folded JSON record
    expect(html).toContain(">Coordinate bots<");
    expect(html).not.toContain(">mcp__agents__coordinate_bots<");
    expect(html).toContain(">check the logs<");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    // the full JSON is folded, one click away, and copyable
    expect(html).toContain("Full JSON");
    expect(html).toContain("Copy JSON");
    expect(html).not.toContain('data-testid="tool-step-json"');
  });

  it("folds a failed MCP call to its product; the tool id only opens with the row", () => {
    // The product name comes from the server (#1216, #1219): the declared name wins,
    // and without one the gateway prefix reads titled.
    const id = "mcp__claude_ai_Example_Gateway__acme_desk__query";
    const tool = { name: id, ok: false, input: JSON.stringify({ resource: "Accounts" }), durationMs: 27_000, product: "Acme Service Desk" };
    const folded = renderToStaticMarkup(createElement(ToolActivity, { tool }));
    expect(folded).toContain(">Could not use Acme Service Desk<");
    expect(folded).toContain(">Accounts<");
    expect(folded).not.toContain("acme_desk");
    const undeclared = renderToStaticMarkup(createElement(ToolActivity, { tool: { ...tool, product: undefined } }));
    expect(undeclared).toContain(">Could not use Acme Desk<");
    expect(undeclared).not.toContain("acme_desk");
    const opened = renderToStaticMarkup(createElement(ToolActivity, { tool, defaultOpen: true }));
    expect(opened).toContain(">Query · Acme Service Desk<");
    expect(opened).not.toContain(`>${id}<`);
  });

  // 2026-11-02 (production): the card showed mcp__sagax-environment__list_files
  // and /data/.openmausbot/workspaces/<bot id> as they were
  it("names a server environment tool in words and shows a bot's id as its name", () => {
    const botId = "5a1d0c3e-7b42-4c8e-9f10-2d3e4f5a6b7c";
    const path = `/data/.openmausbot/workspaces/${botId}`;
    const tool = { name: "mcp__sagax-environment__list_files", ok: false, input: JSON.stringify({ path }), output: "That path is on the Sagax server, not in your environment." };
    const named = renderToStaticMarkup(createElement(ToolActivity, { tool, defaultOpen: true, nameOf: (id: string) => (id === botId ? "Nova" : undefined) }));
    expect(named).toContain(">List files · Your server environment<");
    expect(named).toContain(">/data/.openmausbot/workspaces/Nova<");
    expect(named).toContain(`title="${path}"`);
    // visible text: no raw id, no GUID (the folded JSON is not drawn)
    const visible = named.replace(/title="[^"]*"/g, "");
    expect(visible).not.toContain("mcp__");
    expect(visible).not.toContain(botId);
    const unknown = renderToStaticMarkup(createElement(ToolActivity, { tool, defaultOpen: true }));
    expect(unknown.replace(/title="[^"]*"/g, "")).not.toContain(botId);
    expect(unknown).toContain("The bot&#x27;s own folder");
  });

  it("distinguishes running, failed and unrecorded output", () => {
    const render = (ok?: boolean, live = false) => renderToStaticMarkup(createElement(ToolActivity, { tool: { name: "Read", ok }, live, defaultOpen: true }));
    expect(render(undefined, true)).toContain('data-phase="running"');
    expect(render(undefined, true)).toContain("thinking-shimmer");
    expect(render(undefined, true)).toContain(">Reading a file<");
    expect(render(undefined, true)).toContain("Waiting for the tool to finish");
    // historical incomplete receipt after a restart: no shimmer, "No result"
    expect(render()).toContain('data-phase="unverified"');
    expect(render()).toContain(">Read a file<");
    expect(render()).toContain("No result");
    expect(render()).not.toContain("Waiting for the tool to finish");
    expect(render()).not.toContain("thinking-shimmer");
    expect(render(false)).toContain('data-phase="failed"');
    expect(render(false)).toContain("text-danger");
    expect(render(false)).toContain(">Could not read a file<");
    // a failed call with no text says so, never "nothing was recorded" (#1189)
    expect(render(false)).toContain("The tool failed and returned no error message.");
    expect(render(false)).not.toContain("No output was recorded");
    expect(render(true)).toContain("No output was recorded");
    expect(render(true)).not.toContain("thinking-shimmer");
  });

  it("translates unverified status in active locale", () => {
    try {
      setLocale("fr");
      const html = renderToStaticMarkup(createElement(ToolActivity, { tool: { name: "Read" }, defaultOpen: true }));
      expect(html).toContain("Aucun résultat");
    } finally {
      setLocale("en");
    }
  });

  it("shows a failure's own words, whatever envelope a driver stored (2026-11-03)", () => {
    const render = (output: string) => renderToStaticMarkup(createElement(ToolActivity, { tool: { name: "mcp__sagax-environment__read_file", ok: false, input: JSON.stringify({ path: "../../notes/README.md" }), output }, defaultOpen: true }));
    const refused = "Refusé : ce chemin ou ce fichier appartient au serveur Sagax, pas à votre environnement.";
    // Grok's MCP failure, an MCP isError result, the chat driver's envelope
    for (const output of [
      JSON.stringify({ type: "MCP", output: { Error: refused }, is_error: true }, null, 2),
      JSON.stringify({ content: [{ type: "text", text: refused }], isError: true }),
      JSON.stringify({ ok: false, result: refused }),
      refused,
    ]) {
      const html = render(output);
      expect(html).toContain(refused);
      expect(html).not.toContain("The tool failed and returned no error message.");
      expect(html).not.toContain("is_error");
    }
  });

  // #4146: a failed command's Result leads with its exit code and the end of
  // its error output, never the data markers or "no error message"
  it("shows why a command failed in the environment: exit code, then the end of stderr", () => {
    const why = 'The command failed with exit code 2. End of its error output:\n<<<UNTRUSTED source="tool">>>\ntrace line 39\ntrace line 40\nFileNotFoundError: /srv/data missing\n<<<END UNTRUSTED>>>';
    const full = '<<<UNTRUSTED source="tool">>>\nstarted\n[stderr]\ntrace line 1\n<<<END UNTRUSTED>>>\n[exit 2]';
    for (const output of [
      JSON.stringify({ content: [{ type: "text", text: why }, { type: "text", text: full }], isError: true }),
      JSON.stringify({ type: "MCP", output: { Error: `${why}\n${full}` }, is_error: true }),
    ]) {
      const html = renderToStaticMarkup(createElement(ToolActivity, { tool: { name: "mcp__sagax-environment__run_command", ok: false, input: JSON.stringify({ command: "python3 run.py" }), output }, defaultOpen: true }));
      expect(html).toContain("The command failed with exit code 2. End of its error output:\ntrace line 39\ntrace line 40\nFileNotFoundError: /srv/data missing");
      expect(html).not.toContain("UNTRUSTED");
      expect(html).not.toContain("The tool failed and returned no error message.");
    }
    const silent = renderToStaticMarkup(createElement(ToolActivity, { tool: { name: "mcp__sagax-environment__run_command", ok: false, input: JSON.stringify({ command: "./job.sh" }), output: "The command failed with exit code 3. It printed nothing." }, defaultOpen: true }));
    expect(silent).toContain("The command failed with exit code 3. It printed nothing.");
  });

  it("shows a computer switch as a small line, not a tool disclosure", () => {
    const chip = (target: string, ok?: boolean) => renderToStaticMarkup(createElement(ToolActivity, { tool: { name: "mcp__sagax-computer__computer_select", ok, input: JSON.stringify({ target, reason: "her files" }) } }));
    expect(chip("this_computer", true)).toContain('data-testid="tool-computer-switch"');
    expect(chip("this_computer", true)).toContain("Workspace: My computer");
    expect(chip("cloud", true)).toContain("Workspace: Cloud");
    expect(chip("local_vm", true)).toContain("Workspace: Local VM");
    expect(chip("browser", true)).toContain("Workspace: Browser");
    expect(chip("browser", true)).toContain('data-target="browser"');
    expect(chip("this_computer", true)).not.toContain("data-step-row");
    // a refused switch keeps its details (the reason it failed)
    expect(chip("this_computer", false)).toContain("data-step-row");
  });

  // 2026-10-28: a call Full access (or an Always allow) answered with no card
  // is an ordinary step line; what answered it is in the details only.
  it("keeps what answered the call's ask off the line and in its details", () => {
    const tool = { name: "mcp__desk__view_tickets", ok: true, input: "{}", autoApproval: { source: "full-access" } };
    const closed = renderToStaticMarkup(createElement(ToolActivity, { tool }));
    expect(closed).not.toContain("Approved automatically");
    expect(closed).not.toContain("Always allowed");
    expect(closed).not.toContain("text-success");
    const open = renderToStaticMarkup(createElement(ToolActivity, { tool, defaultOpen: true }));
    expect(open).toContain('data-testid="tool-auto-approval"');
    expect(open).toContain("Approved automatically: Full access");
    const rule = renderToStaticMarkup(createElement(ToolActivity, { tool: { ...tool, autoApproval: { source: "owner-rule", rule: "r1" } }, defaultOpen: true }));
    expect(rule).toContain("Approved automatically: your Always allow rule");
  });

  it("moves a rule's approval into the details; a rule that held or refused keeps its line", () => {
    const notice = { id: "c1", when: "reading the help desk", behavior: "allow" as const, botId: null, outcome: "approved" as const };
    const approved = inStore(createElement(ToolActivity, { tool: { name: "mcp__desk__view_tickets", ok: true, ruleNotice: notice } }));
    expect(approved).not.toContain("data-custom-rule-notice");
    const refused = inStore(createElement(ToolActivity, { tool: { name: "mcp__desk__view_tickets", ok: false, ruleNotice: { ...notice, behavior: "deny" as const, outcome: "denied" as const } } }));
    expect(refused).toContain('data-custom-rule-notice="denied"');
  });
});

describe("a connector's refused sign-in in the step detail (#3515)", () => {
  const output = `MCP error -32603: ${MCP_CREDENTIALS_REFUSED}`;
  const render = () => renderToStaticMarkup(createElement(ToolActivity, { tool: { name: "remote_tool", ok: false, output }, defaultOpen: true }));

  it("reads in French, whole, with its step to take", () => {
    setLocale("fr");
    const html = render();
    setLocale("en");
    expect(html).toContain("Ce connecteur a refusé sa connexion (HTTP 401).");
    expect(html).toContain("ouvre Capacités &gt; Installés et reconnecte-toi");
    expect(html).not.toContain("refused its credentials");
  });

  it("reads in English from the same key", () => {
    setLocale("en");
    const html = render();
    expect(html).toContain("This connector refused its sign-in (HTTP 401).");
    expect(html).toContain("open Capabilities &gt; Installed and sign in to it again");
  });
});

