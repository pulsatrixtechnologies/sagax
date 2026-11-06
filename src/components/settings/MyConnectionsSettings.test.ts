// A person's own connections (organization server), since 2026-10-28 both
// in Connect apps > Providers: GitHub (MyGithubConnection, in its GitHub
// section) and their MCP servers (MyMcpServers). What each state draws, in English
// and in French. A bot's plugins: see
// src/components/plugins/BotPluginCard.test.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { parseArgsLine, parseEnvLines, suggestServerName, type MyConnections } from "@/lib/my-connections";
import { SECTIONS, organizationHidesSection } from "../SettingsModal";
import { MyGithubConnection, MyMcpServers } from "./MyConnectionsSettings";

/** Both parts, as a person sees them across the two tabs. */
function MyConnectionsSettings({ initial }: { initial: MyConnections }) {
  return createElement("div", null, createElement(MyGithubConnection, { initial }), createElement(MyMcpServers, { initial }));
}

afterEach(() => setLocale("en"));

const base: MyConnections = { github: { state: "none", deviceFlow: true }, servers: [], sandbox: true };

describe("Mes connexions", () => {
  it("is no Settings section any more: it lives in Connect apps", () => {
    expect(SECTIONS.map((section) => section.id)).not.toContain("myConnections");
    expect(organizationHidesSection("mail", true)).toBe(true);
    expect(organizationHidesSection("privacy", false)).toBe(true);
  });

  it("GitHub and the servers are two parts, each alone", () => {
    const github = renderToStaticMarkup(createElement(MyGithubConnection, { initial: base }));
    expect(github).toContain("Connect GitHub");
    expect(github).not.toContain("Add an MCP server");
    const servers = renderToStaticMarkup(createElement(MyMcpServers, { initial: base }));
    expect(servers).toContain("Add an MCP server");
    expect(servers).not.toContain("Connect GitHub");
    expect(servers).not.toContain("data-github-state");
  });

  it("offers Connect GitHub with the token under Advanced, and Add an MCP server", () => {
    const html = renderToStaticMarkup(createElement(MyConnectionsSettings, { initial: base }));
    expect(html).toContain('data-github-state="none"');
    expect(html).toContain("Connect GitHub");
    expect(html).not.toContain("Use a token");
    expect(html).toContain("Advanced: use a personal access token");
    expect(html).toContain("Add an MCP server");
    expect(html).toContain("No MCP server of your own yet.");
  });

  // 2026-10-28: one Connect GitHub whatever the server has; without its
  // OAuth App it asks for a token. No admin step (#1550): each person
  // manages their own accounts.
  it("one Connect GitHub (a token) when the server has no GitHub OAuth App, in French", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(MyConnectionsSettings, { initial: { ...base, github: { state: "none", deviceFlow: false } } }));
    expect(html).toContain('data-github-connect="token"');
    expect(html).toContain("Connecter GitHub</button>");
    expect(html).not.toContain("Utiliser un jeton");
    expect(html).not.toContain("admin");
    expect(html).toContain("Ajouter un serveur MCP");
  });

  it("shows the code to type at GitHub, then who is connected", () => {
    const pending = renderToStaticMarkup(createElement(MyConnectionsSettings, { initial: { ...base, github: { state: "pending", deviceFlow: true, userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresAt: 1 } } }));
    expect(pending).toContain("WDJB-MJHT");
    expect(pending).toContain("Open GitHub");
    const connected = renderToStaticMarkup(createElement(MyConnectionsSettings, { initial: { ...base, github: { state: "connected", deviceFlow: true, login: "octo", via: "device", connectedAt: 1 } } }));
    expect(connected).not.toContain("data-github-fine-grained");
    const fine = renderToStaticMarkup(createElement(MyConnectionsSettings, { initial: { ...base, github: { state: "connected", deviceFlow: true, login: "octo", via: "token", connectedAt: 1, fineGrained: true } } }));
    expect(fine).toContain("data-github-fine-grained");
    expect(connected).toContain("Connected as @octo");
    expect(connected).toContain("Disconnect");
    const refused = renderToStaticMarkup(createElement(MyConnectionsSettings, { initial: { ...base, github: { state: "error", deviceFlow: true, error: "GitHub refused this token. Connect again.", login: "octo" } } }));
    expect(refused).toContain("data-github-auth-error");
    expect(refused).toContain("Reconnect");
    expect(refused).not.toContain("Connected as @octo");
  });

  it("lists a person's servers with where they run and what they need", () => {
    const html = renderToStaticMarkup(createElement(MyConnectionsSettings, { initial: { ...base, servers: [
      { name: "notes", kind: "remote", type: "http", url: "https://mcp.notion.com/mcp", domain: "mcp.notion.com", auth: "oauth", tokenConfigured: false, enabled: true, addedAt: 1, authState: "needs_sign_in" },
      { name: "tools", kind: "stdio", command: "npx", args: ["-y", "x"], envKeys: ["API_KEY"], runsIn: "environment", enabled: true, addedAt: 1, authState: "ready" },
    ] } }));
    expect(html).toContain('data-personal-server="notes"');
    expect(html).toContain("sign-in needed");
    expect(html).toContain(">Sign in<");
    expect(html).toContain("npx in your server environment");
  });

  it("the person manages them with no admin, even when an older server still sends managedByAdmin", () => {
    const html = renderToStaticMarkup(createElement(MyConnectionsSettings, { initial: { ...base, managedByAdmin: true, github: { state: "connected", deviceFlow: true, login: "octo", via: "device", connectedAt: 1 }, servers: [
      { name: "notes", kind: "remote", type: "http", url: "https://mcp.notion.com/mcp", domain: "mcp.notion.com", auth: "oauth", tokenConfigured: false, enabled: true, addedAt: 1, authState: "connected" },
    ] } as never }));
    expect(html).not.toContain("administrator");
    expect(html).toContain('data-personal-server="notes"');
    expect(html).toContain("@octo");
    expect(html).toContain('role="switch"');
    expect(html).toContain("Add an MCP server");
  });

  it("reads names, arguments and variables the way a person types them", () => {
    expect(suggestServerName("https://api.githubcopilot.com/mcp/")).toBe("githubcopilot");
    expect(suggestServerName("@modelcontextprotocol/server-github")).toBe("server-github");
    expect(parseArgsLine(`-y "@scope/pkg name" --flag`)).toEqual(["-y", "@scope/pkg name", "--flag"]);
    expect(parseEnvLines("A=1\nB=x=y\n")).toEqual({ ok: true, env: { A: "1", B: "x=y" } });
    expect(parseEnvLines("nope")).toEqual({ ok: false, line: "nope" });
  });
});

