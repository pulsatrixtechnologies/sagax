// The desktop mascot's activity tray, on the brain's side (tested in
// tray.test.ts): this bot's running work, the same list as the bot panel's
// Details > Coding and Activity (GET /api/bots/:id/activity, running entries
// only), with the approvals its conversations wait on first. The window gets
// short texts and opaque ids ("a0", "r1"); the thread and the request stay
// here, so a window can only answer what the brain listed.
import { activityLive, activityStatusActive, activitySubtitle, codingLive, type BotActivityList } from "@/lib/bot-activity";
import type { FloatingTray, FloatingTrayItem } from "./protocol";
import { readableOr } from "../../../shared/human-id";
import { t } from "@/lib/i18n";

/** At most this many rows (approvals first). */
export const TRAY_MAX = 8;
/** A row's detail is cut to this length. */
const DETAIL_MAX = 140;

export interface TrayApproval {
  threadId: string;
  requestId: string;
  tool: string;
  detail: string;
}

/** What a row stands for, kept by the brain. */
export type TrayTarget =
  | { kind: "approval"; botId: string; threadId: string; requestId: string }
  | { kind: "running"; botId: string; threadId: string | null; canStop: boolean };

const cut = (text: string, max = DETAIL_MAX) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * The tray's rows and their targets. `title` names an approval
 * ("Needs you: <tool>"); running entries keep their own title and the
 * panel's subtitle (status, elapsed time, current step).
 */
export function buildTray({ botId, list, approvals, loading, now, title }: {
  botId: string;
  list: BotActivityList | null;
  approvals: readonly TrayApproval[];
  loading: boolean;
  now: number;
  title: (tool: string) => string;
}): { tray: FloatingTray; targets: Map<string, TrayTarget> } {
  const items: FloatingTrayItem[] = [];
  const targets = new Map<string, TrayTarget>();
  approvals.slice(0, TRAY_MAX).forEach((approval, index) => {
    const id = `a${index}`;
    items.push({ id, kind: "approval", title: cut(title(approval.tool), 80), detail: cut(approval.detail), canStop: true, canOpen: true });
    targets.set(id, { kind: "approval", botId, threadId: approval.threadId, requestId: approval.requestId });
  });
  if (list) {
    const seen = new Set<string>();
    const running = [...codingLive(list.items), ...activityLive(list.items, list.subagents)]
      .filter((item) => activityStatusActive(item.status) && !seen.has(item.id) && Boolean(seen.add(item.id)));
    running.slice(0, Math.max(0, TRAY_MAX - items.length)).forEach((item, index) => {
      const id = `r${index}`;
      items.push({ id, kind: "running", title: cut(readableOr(item.title || item.id, t("ids.untitled")), 80), detail: cut(activitySubtitle(item, now)), canStop: Boolean(item.canStop && item.threadId), canOpen: Boolean(item.threadId) });
      targets.set(id, { kind: "running", botId: item.botId, threadId: item.threadId ?? null, canStop: Boolean(item.canStop && item.threadId) });
    });
  }
  return { tray: { loading: loading && items.length === 0, items }, targets };
}
