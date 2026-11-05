// One activity tray at a time for FloatingBots: running work and approvals.
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { api, type AppState, type Bot } from "@/state/store";
import { loadBotActivity, type BotActivityList } from "@/lib/bot-activity";
import { pendingApprovals } from "@/components/PendingApproval";
import { buildTray, type TrayApproval, type TrayTarget } from "./tray";
import { t } from "@/lib/i18n";
import type { FloatingSnapshot } from "./protocol";

export interface FloatingTrayState {
  trayFor: string | null;
  setTrayFor: React.Dispatch<React.SetStateAction<string | null>>;
  trayData: { botId: string; list: BotActivityList | null; approvals: TrayApproval[]; loading: boolean } | null;
  trayTargets: MutableRefObject<Map<string, TrayTarget>>;
  applyTray: (botId: string, snapshot: FloatingSnapshot) => FloatingSnapshot;
}

export function useFloatingTray(stateRef: MutableRefObject<AppState>, bots: readonly Bot[]): FloatingTrayState {
  const [trayFor, setTrayFor] = useState<string | null>(null);
  const [trayData, setTrayData] = useState<{ botId: string; list: BotActivityList | null; approvals: TrayApproval[]; loading: boolean } | null>(null);
  const trayTargets = useRef(new Map<string, TrayTarget>());
  const trayBot = trayFor ? bots.find((candidate) => candidate.id === trayFor) : undefined;
  const traySignature = trayBot ? `${trayBot.threadId}:${(trayBot.tasks ?? []).map((task) => `${task.threadId}:${task.busy ? 1 : 0}:${task.activity ?? ""}:${task.updatedAt ?? 0}`).join("|")}:${trayBot.messages.length}` : "";

  useEffect(() => {
    if (!trayFor) {
      setTrayData(null);
      return;
    }
    let alive = true;
    setTrayData((current) => (current?.botId === trayFor ? current : { botId: trayFor, list: null, approvals: [], loading: true }));
    const load = async () => {
      const bot = stateRef.current.bots.find((candidate) => candidate.id === trayFor);
      if (!bot) return;
      // approvals on the thread on screen (already loaded), then the other threads that wait on the person
      const approvals: TrayApproval[] = pendingApprovals(bot.messages).map((pending) => ({ threadId: bot.threadId, requestId: pending.requestId, tool: pending.tool, detail: pending.detail ?? "" }));
      const waiting = (bot.tasks ?? []).filter((task) => task.activity === "waiting-on-you" && task.threadId !== bot.threadId).slice(0, 4);
      const pages = await Promise.all(waiting.map((task) => api<{ messages?: Parameters<typeof pendingApprovals>[0] }>(`/api/threads/${encodeURIComponent(task.threadId)}/messages?limit=60`).then(
        (page) => pendingApprovals(page.messages ?? []).map((pending) => ({ threadId: task.threadId, requestId: pending.requestId, tool: pending.tool, detail: pending.detail ?? "" })),
        () => [] as TrayApproval[],
      )));
      const list = await loadBotActivity(api, trayFor, { limit: 50 }).catch(() => null);
      if (alive) setTrayData({ botId: trayFor, list, approvals: [...approvals, ...pages.flat()], loading: false });
    };
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [trayFor, traySignature, stateRef]);

  const applyTray = (botId: string, snapshot: FloatingSnapshot): FloatingSnapshot => {
    if (trayFor === botId && trayData?.botId === botId) {
      const built = buildTray({ botId, list: trayData.list, approvals: trayData.approvals, loading: trayData.loading, now: Date.now(), title: (tool) => t("floatingBots.tray.needsYou", { tool }) });
      trayTargets.current = built.targets;
      return { ...snapshot, tray: built.tray };
    }
    if (trayFor === botId) return { ...snapshot, tray: { loading: true, items: [] } };
    return snapshot;
  };

  return { trayFor, setTrayFor, trayData, trayTargets, applyTray };
}
