// #2091 (decided 2026-11-05): the Pulsatrix Flow GO card, as the server builds
// it from a pack guard's elicitation (server/perspicax/go-message.ts +
// confirmHeldCard): a readable title made of the tool and the action, never
// "Marc wants to perspicax"; the human line once and the raw arguments once,
// folded; and Always allow, which keeps a rule for this tool and action.
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Bot, Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), alwaysAllow: true }));
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));
vi.mock("@/lib/org-approval-policy", () => ({ useOrgApprovalPolicy: () => ({ alwaysAllow: fixture.alwaysAllow, orgRules: 0 }), noteOrgAlwaysAllowOff: () => {} }));

import { parseGoMessage } from "../../server/perspicax/go-message.ts";
import { toolApprovalView } from "./ApprovalCard";
import { PendingApprovalActions, PendingApprovalPanel, pendingApprovals } from "./PendingApproval";

beforeEach(() => { fixture.alwaysAllow = true; fixture.dispatch.mockReset(); });
afterEach(() => setLocale("en"));

const bot = { id: "bot-1", name: "Marc" } as never as Bot;

/** What askGo (server/index.ts) sends confirmHeldCard for the reported example */
const GO = parseGoMessage([
  "Pulsatrix Flow needs your GO before this write is sent.",
  "Tool: cw_psa_write",
  "Action: create",
  'Arguments: {"action":"create","parent":299334,"resource":"service.tickets.notes","set":{"text":"Suivi client"}}',
].join("\n"));

function goCard(extra: Record<string, unknown> = {}): Message {
  return {
    id: "m-go",
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Approval needed",
      subtitle: GO.summary,
      options: ["Allow", "Deny"],
      requestId: "req-go",
      tool: "mcp__perspicax__cw_psa_write",
      toolInput: GO.args,
      toolHints: { product: "ConnectWise PSA", productId: "cw_psa" },
      ownerRule: { tool: "safety:mcp__perspicax__cw_psa_write", scope: { action: GO.fingerprint }, description: GO.ruleDescription, from: "hold" },
      ...extra,
    },
  } as unknown as Message;
}

type Node = ReactElement<{ children?: ReactNode; onClick?: () => void }>;
function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}
function actions(message: Message) {
  const pending = pendingApprovals([message])[0]!;
  const tree = PendingApprovalActions({ pending, bot, threadId: "thread-1", onCancelTurn: vi.fn() });
  return { html: renderToStaticMarkup(tree), buttons: nodes(tree).filter((node) => node.type === "button") };
}
const panel = (message: Message) =>
  renderToStaticMarkup(createElement(PendingApprovalPanel, { pending: pendingApprovals([message])[0]!, count: 1, index: 0, bot, onNext: () => {} }));
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the Pulsatrix Flow GO card", () => {
  it("names the write from the tool and the action, never 'wants to perspicax'", () => {
    const view = toolApprovalView(goCard().card!, "Marc");
    expect(view.title).toBe("Marc wants to create a note in ConnectWise PSA");
    expect(view.title).not.toMatch(/wants to perspicax/);
    expect(view.summary).toBe("Create service.tickets.notes under 299334 with cw_psa_write. Pulsatrix Flow asks your GO before this write is sent.");
    expect(view.tool).toBe("cw_psa_write");
    expect(view.risk).toBe("write");
    // without the product's hints the title still names the write
    const bare = { ...goCard().card! } as Record<string, unknown>;
    delete bare.toolHints;
    expect(toolApprovalView(bare as never, "Marc").title).toMatch(/^Marc wants to create a note in /);
  });

  it("shows the human line once and folds the raw arguments once", () => {
    const html = panel(goCard());
    expect(html).toContain("Marc wants to create a note in ConnectWise PSA");
    expect(count(html, "Pulsatrix Flow asks your GO")).toBe(1);
    // the raw JSON is behind Details, never repeated as a monospace row
    expect(html).toContain('data-approval-preview="closed"');
    expect(count(html, "Suivi client")).toBeLessThanOrEqual(1);
    expect(html).not.toMatch(/<code[^>]*>[^<]*Pulsatrix Flow asks your GO/);
  });

  it("offers Always allow, which keeps a rule for cw_psa_write create", () => {
    const result = actions(goCard());
    expect(result.buttons.map((button) => button.props.children)).toContain("Always allow");
    expect(result.html).toContain('data-owner-rule="allow"');
    result.buttons.find((button) => button.props.children === "Always allow")!.props.onClick!();
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ requestId: "req-go", behavior: "allow", rule: "allow" }));
  });

  it("keeps a rule for a batch of a Flow action too, its writes folded once", () => {
    const batch = parseGoMessage([
      "Pulsatrix Flow needs your GO before the 2 write(s) of the action close_resolved are sent:",
      '1. [GO] cw_psa_write {"action":"update","id":1}',
      '2. cw_psa_write {"action":"update","id":2}',
    ].join("\n"));
    const message = goCard({
      tool: "mcp__perspicax__flow_action", subtitle: batch.summary, toolInput: batch.args, toolHints: undefined,
      ownerRule: { tool: "safety:mcp__perspicax__flow_action", scope: { action: batch.fingerprint }, description: batch.ruleDescription, from: "hold" },
    });
    const html = panel(message);
    expect(count(html, "close_resolved are sent")).toBe(1);
    expect(html).not.toMatch(/<code[^>]*>[^<]*Pulsatrix Flow asks your GO/);
    expect(actions(message).buttons.map((button) => button.props.children)).toContain("Always allow");
  });

  it("offers no Always allow only when the organization decided so, and says it in plain words", () => {
    fixture.alwaysAllow = false;
    const result = actions(goCard());
    expect(result.buttons.map((button) => button.props.children)).not.toContain("Always allow");
    expect(result.html).toContain('data-org-always-allow-off=""');
    expect(result.html).toContain("Your organization always asks");
  });
});
