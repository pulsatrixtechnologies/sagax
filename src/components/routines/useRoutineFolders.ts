// The folder actions of one bot's routines (2026-10-28, shared/routine-folders.ts),
// shared by the bot panel's folder list (RoutineFolders.tsx) and the Routines
// page's grouped table: the server call (`act`), move to a folder, step with
// Alt+Up / Alt+Down, reorder, pause or resume a folder, delete with its Undo,
// sort by prefix with its offer, and the drag and drop of a row onto a folder.
// What a surface draws (headers, menus, notices) stays with the surface.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { api, type Bot } from "@/state/store";
import { moveRoutinesToFolder, postFolderAction, type FolderAnswer } from "@/lib/routine-folder-actions";
import { useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import type { Routine } from "@/lib/routines";
import { t } from "@/lib/i18n";
import { flipRoutine } from "@/lib/routine-toggle";
import { useServerFeature } from "@/lib/server-features";
import { answerRoutinePrefixOffer, settleRoutinePrefixOffer } from "@/lib/routine-folder-prefs";
import {
  groupRoutinesByFolder,
  routineFolderKey,
  routinePrefixPlan,
  type RoutineFolderAction,
  type RoutineFolderUndo,
} from "../../../shared/routine-folders";

export type FolderNotice = { text: string; undo: RoutineFolderUndo };

const EMPTY: string[] = [];

export function useRoutineFolders({ bot, routines, allRoutines, onFiledInto }: {
  bot: Bot;
  routines: Routine[];
  /** Every routine of the bot when `routines` is a filtered list: a folder action touches all of them. */
  allRoutines?: Routine[];
  /** A routine was filed into this folder (the panel opens it if folded). */
  onFiledInto?: (folder: string) => void;
}) {
  const dispatch = useStoreDispatch();
  const order = useStoreSelector((current) => current.routineFolders?.[bot.id] ?? EMPTY);
  const storeRoutines = useStoreSelector((current) => current.routines);
  const botRoutines = useMemo(() => {
    const byId = new Map<string, Routine>();
    for (const routine of [...(storeRoutines ?? []), ...(allRoutines ?? [])]) if (routine.botId === bot.id) byId.set(routine.id, routine);
    for (const routine of routines) byId.set(routine.id, routine);
    return [...byId.values()];
  }, [storeRoutines, allRoutines, routines, bot.id]);
  const groups = useMemo(() => groupRoutinesByFolder(routines, order), [routines, order]);
  const folders = groups.flatMap((group) => group.folder ? [group.folder] : []);
  const editable = routines.length === 0 || routines.some((routine) => routine.canEdit !== false);
  // "unknown" (a server from before the feature list) offers folders; the first answer settles it.
  const supported = useServerFeature("routineFolders") !== "no";
  const [serverNote, setServerNote] = useState(false);
  const [notice, setNotice] = useState<FolderNotice | null>(null);
  const prefixPlan = useMemo(() => routinePrefixPlan(routines), [routines]);
  const settle = () => settleRoutinePrefixOffer(bot.id, { loaded: routines.length > 0, hasPrefixTitles: prefixPlan.length > 0, hasFolders: order.length > 0 || routines.some((routine) => !!routine.folder) });
  const [offerAnswered, setOfferAnswered] = useState(settle);
  const [busy, setBusy] = useState(false);
  const pending = useRef(new Set<string>());
  useEffect(() => { setNotice(null); }, [bot.id]);
  useEffect(() => { setOfferAnswered(settle()); }, [bot.id, routines.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const prefixFolders = new Set(prefixPlan.map((step) => routineFolderKey(step.folder))).size;
  const showSortAction = editable && supported && prefixPlan.length > 0;
  const showOffer = editable && supported && !offerAnswered && !notice && prefixPlan.length > 0;

  const act = async (body: RoutineFolderAction): Promise<FolderAnswer | null> => {
    setBusy(true);
    try {
      const result = await postFolderAction(dispatch, body);
      if (!result.ok && result.missing) setServerNote(true);
      return result.ok ? result.answer : null;
    } finally {
      setBusy(false);
    }
  };

  // The row moves at once; if the call fails the row goes back (the error is already told).
  const move = async (routineIds: string[], folder: string | null) => {
    const known = folder === null || folders.some((name) => routineFolderKey(name) === routineFolderKey(folder));
    setBusy(true);
    try {
      // A folder this list does not know yet is created by the server with the move; there is no row to show moving.
      const answer = known
        ? await moveRoutinesToFolder(dispatch, bot.id, routines.filter((routine) => routineIds.includes(routine.id)), folder)
        : await act({ action: "move", botId: bot.id, routineIds, folder });
      if (answer && folder) onFiledInto?.(folder);
    } finally {
      setBusy(false);
    }
  };
  // Alt+Up / Alt+Down on a row: to the previous or next place (no folder, then each folder in order).
  const step = (routine: Routine, direction: -1 | 1) => {
    const places: Array<string | null> = [null, ...folders];
    const at = routine.folder ? places.findIndex((name) => name !== null && routineFolderKey(name) === routineFolderKey(routine.folder!)) : 0;
    const target = places[at + direction];
    if (target === undefined || at < 0) return;
    void move([routine.id], target);
    requestAnimationFrame(() => requestAnimationFrame(() => (document.querySelector(`[data-routine-id="${routine.id}"] button`) as HTMLElement | null)?.focus()));
  };
  const reorder = (folder: string, direction: -1 | 1) => {
    const index = folders.indexOf(folder);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= folders.length) return;
    const next = [...folders];
    [next[index], next[target]] = [next[target]!, next[index]!];
    dispatch({ type: "routineFoldersPatched", botId: bot.id, folders: next });
    void act({ action: "reorder", botId: bot.id, order: next });
  };
  const setFolderEnabled = (folder: string, enabled: boolean) => {
    const key = routineFolderKey(folder);
    for (const routine of botRoutines) {
      if (routine.folder && routineFolderKey(routine.folder) === key && routine.enabled !== enabled) void flipRoutine(routine, pending.current, api, dispatch);
    }
  };
  const removeFolder = async (folder: string) => {
    const key = routineFolderKey(folder);
    const inside = botRoutines.filter((routine) => routine.folder && routineFolderKey(routine.folder) === key);
    const undoData: RoutineFolderUndo = { botId: bot.id, folders: [...folders], routines: inside.map((routine) => ({ id: routine.id, name: routine.name, folder: routine.folder })) };
    const answer = await act({ action: "delete", botId: bot.id, name: folder });
    if (answer) setNotice({ text: t("routineFolders.deleted", { name: folder }), undo: undoData });
  };
  const sortByPrefix = async () => {
    const answer = await act({ action: "sort-by-prefix", botId: bot.id });
    // Marked seen only when it worked: a failure, or a server without the route, leaves the offer where it was.
    if (!answer) return;
    answerRoutinePrefixOffer(bot.id);
    setOfferAnswered(true);
    if (answer.undo) setNotice({ text: t("routineFolders.sorted", { count: answer.routines.length, folders: prefixFolders }), undo: answer.undo });
  };
  const undo = async () => {
    if (!notice) return;
    const answer = await act({ action: "restore", botId: bot.id, undo: notice.undo });
    if (answer) setNotice(null);
  };
  const dismissOffer = () => { answerRoutinePrefixOffer(bot.id); setOfferAnswered(true); };

  // Pressing a row starts nothing until the pointer has moved a few pixels, so a click works as before. Once it moves,
  // a preview follows the pointer, the folder under it lights up, and letting go over a folder, its header or the
  // no-folder area files the routine there. The click that ends a drag is swallowed.
  const [drag, setDrag] = useState<{ routine: Routine; x: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  const folderUnder = (x: number, y: number, fallback: EventTarget | null): string | null => {
    const hit = (typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null) ?? (fallback instanceof Element ? fallback : null);
    const section = hit?.closest("[data-routine-folder-section]");
    return section ? section.getAttribute("data-routine-folder-section") : null;
  };
  const moveRef = useRef<(id: string, folder: string | null) => void>(() => {});
  moveRef.current = (id, folder) => { void move([id], folder); };
  const startDrag = (routine: Routine, down: ReactPointerEvent<HTMLElement>) => {
    dragCleanup.current?.();
    const originX = down.clientX;
    const originY = down.clientY;
    let active = false;
    let target: string | null = null;
    const onMove = (event: PointerEvent) => {
      if (!active) {
        if (Math.hypot(event.clientX - originX, event.clientY - originY) < 5) return;
        active = true;
        document.body.style.userSelect = "none";
      }
      setDrag({ routine, x: event.clientX, y: event.clientY });
      target = folderUnder(event.clientX, event.clientY, event.target);
      setDropTarget(target);
    };
    const swallowClick = (event: MouseEvent) => { event.stopPropagation(); event.preventDefault(); };
    const finish = (drop: boolean) => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keydown", key, true);
      document.body.style.userSelect = "";
      dragCleanup.current = null;
      setDrag(null);
      setDropTarget(null);
      if (!active) return;
      window.addEventListener("click", swallowClick, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallowClick, true), 0);
      if (drop && target !== null && routineFolderKey(routine.folder ?? "") !== routineFolderKey(target)) moveRef.current(routine.id, target === "" ? null : target);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); finish(false); } };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("keydown", key, true);
    dragCleanup.current = () => finish(false);
  };

  return {
    dispatch, groups, folders, botRoutines, editable, supported, busy, pending, serverNote, setServerNote, notice, setNotice,
    prefixPlan, prefixFolders, showSortAction, showOffer, dismissOffer,
    act, move, step, reorder, setFolderEnabled, removeFolder, sortByPrefix, undo,
    drag, dropTarget, startDrag, canDrag: editable && supported && folders.length > 0,
  };
}
