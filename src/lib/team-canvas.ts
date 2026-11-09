import type { TeamMapSection } from "./team-map";

export interface Point { x: number; y: number }
export interface View extends Point { scale: number }
export interface Tile extends Point { key: string; width: number; height: number }

export const CARD_WIDTH = 236;
export const CARD_HEIGHT = 126;
export const GAP = 16;
export const TEAM_PADDING = 20;
export const HEADER_HEIGHT = 64;

/** Personal card order never changes a bot's team or Chief role. */
export function orderBots<T extends { id: string }>(bots: T[], order: string[] = []): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...bots].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}

export function reorderBot(bots: { id: string }[], botId: string, insertionIndex: number): string[] {
  const ids = bots.map((bot) => bot.id);
  if (!ids.includes(botId)) return ids;
  const remaining = ids.filter((id) => id !== botId);
  remaining.splice(Math.max(0, Math.min(remaining.length, insertionIndex)), 0, botId);
  return remaining;
}

export function parseBotOrders(raw: string | null): Record<string, string[]> {
  try {
    const parsed: unknown = JSON.parse(raw ?? "null");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, value]) => Array.isArray(value)
      ? [[key, [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))]]]
      : []));
  } catch {
    return {};
  }
}

export function teamSize(section: TeamMapSection): { width: number; height: number } {
  const hierarchy = section.chiefs.length > 0 && section.members.length > 0;
  const rows = hierarchy
    ? Math.max(section.chiefs.length, section.members.length)
    : Math.max(1, section.chiefs.length + section.members.length);
  return {
    width: CARD_WIDTH * (hierarchy ? 2 : 1) + TEAM_PADDING * 2 + (hierarchy ? 40 : 0),
    height: HEADER_HEIGHT + TEAM_PADDING + rows * (CARD_HEIGHT + GAP) - GAP,
  };
}

export function layoutTeams(sections: TeamMapSection[], positions: Record<string, Point>): Tile[] {
  const sizes = sections.map(teamSize);
  const firstColumnWidth = Math.max(0, ...sizes.filter((_, index) => index % 2 === 0).map((size) => size.width));
  let y = 40;
  return sections.map((section, index) => {
    if (index > 0 && index % 2 === 0) {
      y += Math.max(sizes[index - 2].height, sizes[index - 1].height) + 56;
    }
    const saved = Object.hasOwn(positions, section.key) ? positions[section.key] : undefined;
    return {
      key: section.key,
      x: saved?.x ?? (index % 2 === 0 ? 40 : 40 + firstColumnWidth + 56),
      y: saved?.y ?? y,
      ...sizes[index],
    };
  });
}

export function fitTeams(tiles: Tile[], width: number, height: number): View {
  if (!tiles.length) return { x: 0, y: 0, scale: 1 };
  const left = Math.min(...tiles.map((tile) => tile.x));
  const top = Math.min(...tiles.map((tile) => tile.y));
  const contentWidth = Math.max(...tiles.map((tile) => tile.x + tile.width)) - left;
  const contentHeight = Math.max(...tiles.map((tile) => tile.y + tile.height)) - top;
  const scale = Math.max(0.3, Math.min(1, (width - 80) / contentWidth, (height - 80) / contentHeight));
  return {
    x: (width - contentWidth * scale) / 2 - left * scale,
    y: (height - contentHeight * scale) / 2 - top * scale,
    scale,
  };
}

export function zoomAt(view: View, nextScale: number, point: Point): View {
  const ratio = nextScale / view.scale;
  return {
    x: point.x - (point.x - view.x) * ratio,
    y: point.y - (point.y - view.y) * ratio,
    scale: nextScale,
  };
}

export type WheelCanvasDelta =
  | { kind: "zoom"; factor: number }
  | { kind: "pan"; dx: number; dy: number };

/**
 * Figma-style wheel: pinch or a plain mouse wheel zooms at the pointer;
 * Shift+wheel or a trackpad two-finger scroll pans. A trackpad is detected
 * by a horizontal delta or a fractional pixel deltaY (mouse wheels report
 * integer line/pixel steps).
 */
export function wheelCanvasDelta(
  event: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "ctrlKey" | "metaKey" | "shiftKey">,
  boundsHeight: number,
): WheelCanvasDelta {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? boundsHeight : 1;
  const pinch = event.ctrlKey || event.metaKey;
  const trackpadPan = !pinch && (Math.abs(event.deltaX) > 0
    || (event.deltaMode === 0 && !Number.isInteger(event.deltaY)));
  if (pinch || (!event.shiftKey && !trackpadPan)) {
    return { kind: "zoom", factor: Math.exp(-event.deltaY * (pinch ? 0.01 : 0.006)) };
  }
  if (event.shiftKey && event.deltaX === 0) {
    return { kind: "pan", dx: event.deltaY * unit, dy: 0 };
  }
  return { kind: "pan", dx: event.deltaX * unit, dy: event.deltaY * unit };
}

export function parsePositions(raw: string | null): Record<string, Point> {
  try {
    const parsed: unknown = JSON.parse(raw ?? "null");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, value]) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
      const { x, y } = value;
      return typeof x === "number" && Number.isFinite(x) && Math.abs(x) < 100_000 &&
        typeof y === "number" && Number.isFinite(y) && Math.abs(y) < 100_000
        ? [[key, { x, y }]]
        : [];
    }));
  } catch {
    return {};
  }
}

/**
 * Where the map's layout (team positions and the personal card order) is
 * kept. On an organization server it follows the person to every device
 * (shared/user-preferences.ts, synced through /api/me/preferences); a solo
 * server keeps it in this browser, per workspace, as before.
 */
export const TEAM_CANVAS_POSITIONS_KEY = "sagax.teamCanvasPositions.v1";
export const TEAM_CANVAS_BOT_ORDER_KEY = "sagax.teamCanvasBotOrder.v1";

export interface TeamCanvasKeys { positions: string; botOrder: string }

/** The per-workspace keys of this browser (`omb-team-canvas:<environment>`). */
export function workspaceCanvasKeys(environmentId: string): TeamCanvasKeys {
  const base = `omb-team-canvas:${environmentId}`;
  return { positions: base, botOrder: `${base}:bot-order` };
}

export function teamCanvasKeys(environmentId: string, organization: boolean): TeamCanvasKeys {
  return organization ? { positions: TEAM_CANVAS_POSITIONS_KEY, botOrder: TEAM_CANVAS_BOT_ORDER_KEY } : workspaceCanvasKeys(environmentId);
}

/**
 * Reads the layout. On an organization server, a person who arranged the
 * map before it followed them keeps that arrangement: the browser's own
 * copy is moved into the synced keys once, when they are still empty.
 */
export function loadTeamCanvasLayout(storage: Pick<Storage, "getItem" | "setItem">, environmentId: string, organization: boolean): { keys: TeamCanvasKeys; positions: Record<string, Point>; botOrders: Record<string, string[]> } {
  const keys = teamCanvasKeys(environmentId, organization);
  if (organization) {
    const local = workspaceCanvasKeys(environmentId);
    for (const [synced, own] of [[keys.positions, local.positions], [keys.botOrder, local.botOrder]] as const) {
      if (storage.getItem(synced) !== null) continue;
      const value = storage.getItem(own);
      if (value !== null) storage.setItem(synced, value);
    }
  }
  return { keys, positions: parsePositions(storage.getItem(keys.positions)), botOrders: parseBotOrders(storage.getItem(keys.botOrder)) };
}
