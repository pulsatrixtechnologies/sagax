// ConnectWise widgets on the server: the widget a completed call maps to,
// and the changes a widget asks for.
//
// A change never runs from the widget. POST /api/threads/<id>/cw-actions
// writes an ordinary approval card in the conversation. Allow sends the bot
// one message, as the person, asking for that one write, and leaves a
// one-shot pass for it: the bot's next ConnectWise write in that thread that
// names the same record is approved without a second card. Deny closes the
// card and nothing is sent. A pass lapses after ten minutes or when used.

import { randomUUID } from "node:crypto";

import { cwSite } from "../shared/cw-widgets/links.ts";
import { cwWidgetFromToolCall, isCwViewTool, isCwWriteTool } from "../shared/cw-widgets/tool-call.ts";
import type { CwSite, CwWidget } from "../shared/cw-widgets/types.ts";
import { cwActionMatchesWrite, cwActionSummary, cwActionWrite, type CwAction, type CwLanguage } from "../shared/cw-widgets/actions.ts";
import { askedForView } from "../shared/requested-views.ts";
import { redactSecrets } from "./redact.ts";

export const CW_ACTION_PASS_MS = 10 * 60_000;
export const CW_ACTION_REQUEST_PREFIX = "cwact-";

/** The site deep links open: SAGAX_CW_SITE (the web host, or the API host)
 * and SAGAX_CW_COMPANY_ID (the company id typed at sign-in). Without them,
 * links follow the `_info` addresses of the records themselves. */
export function cwSiteFromEnv(env: NodeJS.ProcessEnv = process.env): CwSite | undefined {
  return cwSite(env.SAGAX_CW_SITE, env.SAGAX_CW_COMPANY_ID);
}

export function cwToolWidget(toolName: string, inputPreview: string | undefined, resultText: string): CwWidget | null {
  let widget: CwWidget | null;
  try {
    const site = cwSiteFromEnv();
    widget = cwWidgetFromToolCall(toolName, inputPreview, resultText, site ? { site } : {});
  } catch {
    return null;
  }
  return widget ? redactSecrets(widget) as CwWidget : null;
}

/** The widget a completed call's tool row carries: only a Perspicax view
 * tool's (`isCwViewTool`), and only when the person's message of the turn
 * asked for a view (`askedForView`, shared/requested-views.ts). Every other ConnectWise call keeps a plain row;
 * a view the person asks for in words comes as a ```cw fence in the reply. */
export function cwToolRowWidget(toolName: string, inputPreview: string | undefined, resultText: string, personText?: string): CwWidget | null {
  return isCwViewTool(toolName) && askedForView(personText, "view") ? cwToolWidget(toolName, inputPreview, resultText) : null;
}

export function cwActionLanguage(language: string | undefined): CwLanguage {
  return language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

/** The approval card's fields for one action (the message's `card`). */
export function cwActionCard(action: CwAction, language: CwLanguage, by: string): {
  requestId: string;
  summary: string;
  toolInput: string;
  cwActionRequest: { id: string; action: CwAction; by: string };
} {
  const requestId = `${CW_ACTION_REQUEST_PREFIX}${randomUUID()}`;
  return {
    requestId,
    summary: cwActionSummary(action, language),
    toolInput: JSON.stringify(cwActionWrite(action), null, 2),
    cwActionRequest: { id: requestId, action, by },
  };
}

interface Pass {
  action: CwAction;
  expires: number;
}

export interface CwActionPasses {
  grant(threadId: string, action: CwAction): void;
  /** The pass a ConnectWise write in this thread uses, removed; null when
   * the call is not the change that was allowed. */
  take(threadId: string, tool: string, input: string | undefined): CwAction | null;
  /** Withdraw a pass whose message never reached the bot. */
  revoke(threadId: string, action: CwAction): void;
  size(): number;
}

export function createCwActionPasses(now: () => number = Date.now): CwActionPasses {
  const passes = new Map<string, Pass[]>();
  const live = (threadId: string): Pass[] => {
    const kept = (passes.get(threadId) ?? []).filter((pass) => pass.expires > now());
    if (kept.length) passes.set(threadId, kept);
    else passes.delete(threadId);
    return kept;
  };
  return {
    grant(threadId, action) {
      const kept = live(threadId);
      kept.push({ action, expires: now() + CW_ACTION_PASS_MS });
      passes.set(threadId, kept.slice(-20));
    },
    take(threadId, tool, input) {
      if (!input || !isCwWriteTool(tool)) return null;
      const kept = live(threadId);
      const index = kept.findIndex((pass) => cwActionMatchesWrite(pass.action, input));
      if (index < 0) return null;
      const [pass] = kept.splice(index, 1);
      if (kept.length) passes.set(threadId, kept);
      else passes.delete(threadId);
      return pass!.action;
    },
    revoke(threadId, action) {
      const wanted = JSON.stringify(action);
      const kept = live(threadId);
      const index = kept.findIndex((pass) => JSON.stringify(pass.action) === wanted);
      if (index >= 0) kept.splice(index, 1);
      if (kept.length) passes.set(threadId, kept);
      else passes.delete(threadId);
    },
    size() {
      let count = 0;
      for (const threadId of Array.from(passes.keys())) count += live(threadId).length;
      return count;
    },
  };
}
