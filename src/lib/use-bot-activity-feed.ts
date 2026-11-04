// Shared polling and live linger for bot activity lists (panel and sidebar).
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import { api, type Bot } from "@/state/store";
import {
  activitySignature,
  activityStatusActive,
  LiveActivity,
  loadBotActivity,
  loadBotActivityDetail,
  type BotActivityItem,
  type BotActivityList,
} from "@/lib/bot-activity";

const POLL_ACTIVE_MS = 4_000;
const POLL_IDLE_MS = 30_000;
const LIST_LIMIT = 50;

export function useBotActivityFeed(bot: Bot) {
  const dispatch = useStoreDispatch();
  const [list, setList] = useState<BotActivityList | null>(null);
  const [error, setError] = useState(false);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const tracker = useRef<LiveActivity | null>(null);
  tracker.current ??= new LiveActivity(rerender);
  useEffect(() => () => tracker.current?.dispose(), []);
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const request = useRef(0);
  const signature = activitySignature(bot.tasks);

  const refresh = useCallback(() => {
    const id = ++request.current;
    return loadBotActivity(api, bot.id, { limit: LIST_LIMIT })
      .then((next) => {
        if (id !== request.current) return;
        tracker.current?.update([...next.items, ...next.subagents]);
        setList(next);
        setNow(Date.now());
        setError(false);
      })
      .catch(() => {
        if (id === request.current) setError(true);
      });
  }, [bot.id]);

  useEffect(() => {
    setList(null);
    setError(false);
    tracker.current?.dispose();
    tracker.current = new LiveActivity(rerender);
  }, [bot.id]);

  const target = useStoreSelector((current) => current.botActivityTarget?.botId === bot.id ? current.botActivityTarget : null);
  const [deepLinked, setDeepLinked] = useState<BotActivityItem | null>(null);
  useEffect(() => {
    if (!target || target.botId !== bot.id) return;
    dispatch({ type: "botActivityOpened" });
    let live = true;
    loadBotActivityDetail(api, bot.id, target.itemId)
      .then((detail) => { if (live) setDeepLinked(detail); })
      .catch(() => {});
    return () => { live = false; };
  }, [target, bot.id, dispatch]);

  useEffect(() => { void refresh(); }, [refresh, signature]);
  useEffect(() => {
    const onCloud = (event: Event) => {
      const botId = (event as CustomEvent<{ botId?: string }>).detail?.botId;
      if (botId === bot.id) void refresh();
    };
    window.addEventListener("sagax-cloud-agent", onCloud);
    return () => window.removeEventListener("sagax-cloud-agent", onCloud);
  }, [bot.id, refresh]);
  const active = Boolean(list && (
    [...list.items, ...list.subagents].some((item) => activityStatusActive(item.status))
    || (list.launchedAgents ?? []).some((item) => activityStatusActive(item.status))
  ));
  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(); }, active ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    return () => window.clearInterval(timer);
  }, [refresh, active]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  const stop = useCallback((item: BotActivityItem) => {
    setStopping((current) => new Set(current).add(item.id));
    const done = () => setStopping((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
    if (item.id.startsWith("cloud:")) {
      const cloudId = item.id.slice("cloud:".length);
      void api(`/api/bots/${encodeURIComponent(item.botId)}/cloud-agents/${encodeURIComponent(cloudId)}/cancel`, { method: "POST" })
        .catch(done)
        .finally(() => { done(); void refresh(); });
      return;
    }
    if (!item.threadId) {
      done();
      return;
    }
    dispatch({ type: "interrupt", botId: item.botId, threadId: item.threadId, onError: done });
    window.setTimeout(() => { done(); void refresh(); }, 1_500);
  }, [dispatch, refresh]);

  const live = tracker.current.view();
  return {
    list,
    error,
    refresh,
    stop,
    stopping,
    now,
    live,
    deepLinked,
    clearDeepLink: () => setDeepLinked(null),
  };
}
