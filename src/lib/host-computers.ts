// Bot computers (#2726, #2727): enrolled hosts the person marked "Use as a
// bot computer". The host row's ⋯ menu sets the toggle and the tags; the
// bot's Computer menus list the marked hosts and save the bot's choice
// (server/routes/host-computers.ts). No host id on screen.
import { useCallback, useEffect, useState } from "react";

import { api } from "@/state/store";
import {
  sortHostChoices,
  type BotComputerHostMode,
  type BotComputerHostView,
} from "../../shared/bot-computer-host";

export const HOST_COMPUTERS_CHANGED = "sagax:host-computers-changed";

function changed(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(HOST_COMPUTERS_CHANGED));
}

export async function loadHostComputers(): Promise<BotComputerHostView[]> {
  const body = await api<{ hosts?: BotComputerHostView[] }>("/api/host-computers");
  return Array.isArray(body.hosts) ? body.hosts : [];
}

export async function patchHostComputer(hostId: string, patch: {
  botComputer?: boolean;
  tags?: string[];
  mode?: { botId: string; value: BotComputerHostMode | null };
}): Promise<BotComputerHostView | null> {
  const body = await api<{ host?: BotComputerHostView | null }>(`/api/host-computers/${encodeURIComponent(hostId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  changed();
  return body.host ?? null;
}

/** The Computer choices of one bot: the marked hosts, online first, and the one it works on. */
export async function loadBotHostComputer(botId: string): Promise<{ hostId: string | null; hosts: BotComputerHostView[] }> {
  const body = await api<{ hostId?: string | null; hosts?: BotComputerHostView[] }>(`/api/bots/${encodeURIComponent(botId)}/host-computer`);
  return { hostId: body.hostId ?? null, hosts: sortHostChoices(Array.isArray(body.hosts) ? body.hosts : []) };
}

/** Pick a host as the bot's computer (null: back to the other choices).
 * `asked` is true when the bot's chat now shows the isolated / as-is question. */
export async function selectBotHostComputer(botId: string, hostId: string | null): Promise<{ asked: boolean }> {
  const body = await api<{ asked?: boolean }>(`/api/bots/${encodeURIComponent(botId)}/host-computer`, {
    method: hostId ? "PUT" : "DELETE",
    ...(hostId ? { body: JSON.stringify({ hostId }) } : {}),
  });
  changed();
  return { asked: body.asked === true };
}

/** Every host the person enrolled, with its bot-computer settings. */
export function useHostComputers(enabled = true): { hosts: BotComputerHostView[]; reload: () => void } {
  const [hosts, setHosts] = useState<BotComputerHostView[]>([]);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadHostComputers().then((list) => { if (alive) setHosts(list); }).catch(() => { if (alive) setHosts([]); });
    return () => { alive = false; };
  }, [enabled, tick]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener(HOST_COMPUTERS_CHANGED, reload);
    return () => window.removeEventListener(HOST_COMPUTERS_CHANGED, reload);
  }, [reload]);
  return { hosts, reload };
}

/** One bot's host choices and the one it works on. */
export function useBotHostComputer(botId: string | null | undefined): {
  hostId: string | null;
  hosts: BotComputerHostView[];
  select: (hostId: string | null) => Promise<void>;
} {
  const [state, setState] = useState<{ hostId: string | null; hosts: BotComputerHostView[] }>({ hostId: null, hosts: [] });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!botId) return;
    let alive = true;
    loadBotHostComputer(botId).then((next) => { if (alive) setState(next); }).catch(() => { if (alive) setState({ hostId: null, hosts: [] }); });
    return () => { alive = false; };
  }, [botId, tick]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const again = () => setTick((value) => value + 1);
    window.addEventListener(HOST_COMPUTERS_CHANGED, again);
    return () => window.removeEventListener(HOST_COMPUTERS_CHANGED, again);
  }, []);
  const select = useCallback(async (hostId: string | null) => {
    if (!botId) return;
    setState((prev) => ({ ...prev, hostId }));
    await selectBotHostComputer(botId, hostId).catch(() => setTick((value) => value + 1));
  }, [botId]);
  return { ...state, select };
}
