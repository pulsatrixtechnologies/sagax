// 2026-10-28: a call whose permission ask was answered with no card (Full
// access, an Always allow, a saved rule, a read Sagax trusts) is one
// ordinary tool row. What answered it rides that row (`tool.autoApproval`)
// and shows only in its details, never as a row of its own: a separate
// "approved ... (full access)" line under each call read like a permission
// asked every time. The decision log keeps the full record either way.
//
// The engine may write the call's row before it asks (Claude) or after the
// answer (others). Before: the newest row of that tool without an answer
// takes it. After: the answer waits here, per conversation, for the row.

import type { CustomRuleNotice } from "../../shared/custom-rules.ts";

export interface ToolAutoApproval {
  /** The decision log's source (auto-approve.ts AutoVerdict.source). */
  source: string;
  /** The rule that answered, when one did. */
  rule?: string;
}

type Row = { id: string; kind?: string; role?: string; tool?: { name: string; autoApproval?: unknown } };

/** How many rows back the call's row is looked for, and how many answers
 * wait per conversation. */
const LOOK_BACK = 40;
const MAX_PENDING = 20;

/** The names one tool goes by: the engine's (`mcp__server__tool`), the
 * server's (`server__tool`) and the bare tool. */
export function toolNameKeys(name: string | undefined): string[] {
  const raw = name?.trim();
  if (!raw) return [];
  const withoutPrefix = raw.replace(/^mcp__/, "");
  const bare = withoutPrefix.includes("__") ? withoutPrefix.slice(withoutPrefix.lastIndexOf("__") + 2) : withoutPrefix;
  return [...new Set([raw.toLowerCase(), withoutPrefix.toLowerCase(), bare.toLowerCase()])];
}

function sameTool(rowName: string, names: ReadonlyArray<string | undefined>): boolean {
  const wanted = new Set(names.flatMap((name) => toolNameKeys(name)));
  const row = toolNameKeys(rowName);
  // the full names first; the bare tool only when nothing fuller was given
  return row.slice(0, 2).some((key) => wanted.has(key)) || (row[2] !== undefined && wanted.has(row[2]) && names.every((name) => !name || !name.includes("__")));
}

export function createAutoApprovalNotes() {
  const pending = new Map<string, Array<{ names: ReadonlyArray<string | undefined>; approval: ToolAutoApproval; notice?: CustomRuleNotice }>>();
  return {
    /** The newest row of this tool, among the last ones, with no answer yet. */
    rowFor<T extends Row>(rows: readonly T[], names: ReadonlyArray<string | undefined>): T | undefined {
      for (let index = rows.length - 1, seen = 0; index >= 0 && seen < LOOK_BACK; index -= 1, seen += 1) {
        const row = rows[index]!;
        if (row.kind !== "activity" || !row.tool || row.tool.autoApproval) continue;
        if (sameTool(row.tool.name, names)) return row;
      }
      return undefined;
    },
    remember(threadId: string, names: ReadonlyArray<string | undefined>, approval: ToolAutoApproval, notice?: CustomRuleNotice): void {
      const list = pending.get(threadId) ?? [];
      list.push({ names, approval, ...(notice ? { notice } : {}) });
      while (list.length > MAX_PENDING) list.shift();
      pending.set(threadId, list);
    },
    /** The oldest waiting answer for a row of this tool, taken once. */
    takePending(threadId: string, rowName: string): { approval: ToolAutoApproval; notice?: CustomRuleNotice } | undefined {
      const list = pending.get(threadId);
      if (!list?.length) return undefined;
      const index = list.findIndex((entry) => sameTool(rowName, entry.names));
      if (index < 0) return undefined;
      const [entry] = list.splice(index, 1);
      if (!list.length) pending.delete(threadId);
      return entry ? { approval: entry.approval, ...(entry.notice ? { notice: entry.notice } : {}) } : undefined;
    },
    /** A conversation's turn ended: answers no row took are dropped. */
    clear(threadId: string): void {
      pending.delete(threadId);
    },
  };
}
