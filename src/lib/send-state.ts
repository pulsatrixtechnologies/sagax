// Whether the composer may send to this bot now (shared/send-state.ts, GET
// /api/bots/<id>/send-state). A certain "no" keeps the message from going out
// and shows one line with the reason and the one thing to do; the draft stays.
// Asked again while blocked, on focus and when the bot changes, so the
// composer comes back by itself once the cause is fixed. Any doubt (no
// answer, an error, an older server) sends as before.
import { useCallback, useEffect, useRef, useState } from "react";

import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import type { SendBlock } from "../../shared/send-state";

export type { SendBlock };

/** While blocked, how often the composer asks again. */
export const SEND_BLOCK_RECHECK_MS = 15_000;

/** Whether this block keeps a message from going out. An advisory line
 * (#2013: the engine refused the last turn before any prompt went out)
 * informs and the composer still sends: sending again is the retry. */
export function sendBlockStops(block: SendBlock | null | undefined): boolean {
  return Boolean(block) && block!.advisory !== true;
}

/** #2013: the composer's Fix (POST /api/bots/<id>/send-state/fix). Resolves
 * to the send state the server answers after the repair; rejects when the
 * repair failed. */
export async function fixSendBlock(botId: string, threadId: string | undefined, fix: string): Promise<SendBlock | null> {
  const query = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
  const body = await api<unknown>(`/api/bots/${encodeURIComponent(botId)}/send-state/fix${query}`, { method: "POST", body: JSON.stringify({ fix }) });
  return parseSendBlock(body);
}

/** The line above the composer, in the reader's language. */
export function sendBlockText(block: SendBlock): string {
  switch (block.reason) {
    case "engine_not_connected": return t("sendBlock.engineNotConnected", { engine: block.name ?? (block.action.kind === "connect" ? block.action.engine : "") });
    case "computer_offline": return t("sendBlock.computerOffline");
    case "local_server_offline": return t("sendBlock.localServerOffline");
    case "owner_computer_offline": return block.name ? t("sendBlock.ownerComputerOffline", { owner: block.name }) : t("sendBlock.ownerComputerOfflineUnnamed");
    // #2013: the engine refused the last turn before any prompt went out.
    case "engine_refused": return block.refusal?.kind === "config_conflict"
      ? t("sendBlock.engineConfigConflict", { engine: block.name ?? "" })
      : t("sendBlock.engineNotReady", { engine: block.name ?? "" });
    case "engine_signed_out": return t("sendBlock.engineSignedOut", { engine: block.name ?? "" });
    default: return block.message;
  }
}

/** The action button's label. */
export function sendBlockActionLabel(block: SendBlock): string {
  if (block.action.kind === "fix") return t("sendBlock.fix");
  if (block.action.kind === "resend") return t("sendBlock.retry");
  if (block.reason === "engine_signed_out") return t("sendBlock.signIn");
  return block.action.kind === "connect" ? t("sendBlock.connect", { engine: block.action.engine }) : t("sendBlock.retry");
}

/** A block only when the server says so plainly; anything else is none.
 * #3552: an older server's usage-limit block (its "switch_engine" action) is
 * none either: the message goes out and the server holds it for the reset. */
export function parseSendBlock(body: unknown): SendBlock | null {
  const block = (body as { block?: unknown } | null)?.block as Partial<SendBlock> | null | undefined;
  if (!block || typeof block !== "object" || typeof block.reason !== "string" || typeof block.message !== "string") return null;
  const action = block.action as SendBlock["action"] | undefined;
  if (!action || (action.kind !== "retry" && action.kind !== "resend"
    && !(action.kind === "fix" && typeof action.fix === "string")
    && !(action.kind === "connect" && typeof action.engine === "string" && typeof action.instanceId === "string"))) return null;
  return block as SendBlock;
}

export function useSendBlock(botId: string | undefined, threadId: string | undefined, key: unknown): { block: SendBlock | null; recheck: () => void } {
  const [block, setBlock] = useState<SendBlock | null>(null);
  const [tick, setTick] = useState(0);
  const recheck = useCallback(() => setTick((value) => value + 1), []);
  const blockedRef = useRef(false);
  blockedRef.current = block !== null;

  useEffect(() => {
    if (!botId) { setBlock(null); return; }
    let alive = true;
    const query = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
    api<unknown>(`/api/bots/${encodeURIComponent(botId)}/send-state${query}`)
      .then((body) => { if (alive) setBlock(parseSendBlock(body)); }, () => { if (alive) setBlock(null); });
    return () => { alive = false; };
  }, [botId, threadId, key, tick]);

  useEffect(() => {
    if (!block) return;
    const timer = setInterval(recheck, SEND_BLOCK_RECHECK_MS);
    return () => clearInterval(timer);
  }, [block, recheck]);

  useEffect(() => {
    const onFocus = () => { if (blockedRef.current) recheck(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [recheck]);

  return { block, recheck };
}
