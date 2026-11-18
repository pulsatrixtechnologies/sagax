// The Team map's org chart: where each team goes and which links are drawn.
// Pure, so the placement rules are tested. Placement follows the work: the
// lead on top; the teams that receive the most handoffs from the lead closest
// to it, in one row under it (the busiest in the middle); a team that gets
// work from another team sits under that team; unlinked teams fill what is
// left, and "Sans équipe" (unassigned) is last and apart. A team shows its
// first four bots, then "+N" (expanded on demand).
import type { TeamMapPair } from "./team-map";

export const BLOCK_W = 216;
export const GAP_X = 72;
export const GAP_Y = 72;
export const HEAD_H = 44;
export const CARD_H = 40;
export const CARD_GAP = 12;
export const PAD = 12;
export const MORE_H = 24;
export const LEAD_H = 48;
export const LANE = 56;
export const MARGIN_X = 44;
/** The page keeps its toolbar clear (TOP_RESERVE in the chart), so the chart itself starts near its top edge. */
export const MARGIN_TOP = 16;
export const SHOW = 4;
export const TRAY_H = 48;
/** Sans équipe sits apart: below the last team, a little closer than two teams are. */
export const TRAY_GAP = 48;
export const MARGIN_BOTTOM = 24;

export interface OrgBot { id: string; name: string; chiefOfStaff?: boolean }
export interface OrgSection<T extends OrgBot> {
  key: string;
  name: string;
  chiefs: T[];
  members: T[];
  parent?: string;
  depth?: number;
}

export interface OrgOptions {
  /** How many team columns fit the width (3 to 5). */
  columns: number;
  /** The viewer's own lead bot (its Primary Bot), when it has one. */
  leadId?: string | null;
  pairs: TeamMapPair[];
  /** A person's own card order for a team (drag to arrange), empty when none. */
  personalOrder?: (teamKey: string) => string[];
  /** Teams whose hidden bots are shown. */
  expanded?: ReadonlySet<string>;
  /** Unassigned tray opened. */
  trayOpen?: boolean;
}

export interface Rect { x: number; y: number; w: number; h: number }
export interface PlacedBot<T extends OrgBot> extends Rect { bot: T }
export interface OrgBlock<T extends OrgBot> extends Rect {
  key: string;
  name: string;
  parent?: string;
  col: number;
  tier: number;
  bots: PlacedBot<T>[];
  total: number;
  hidden: number;
  expanded: boolean;
  moreY: number;
  /** Every bot of the team in flow order, hidden ones included. */
  ordered: T[];
}

export type LinkKind = "lead" | "team" | "bot";
export interface OrgLink {
  id: string;
  kind: LinkKind;
  fromKey: string;
  toKey: string;
  /** Bots at either end when the link is one bot's (in-team). */
  fromBot?: string;
  toBot?: string;
  path: string;
  /** The arrow head (delegation) or the open circle (review). */
  end: { x: number; y: number; angle: number };
  badge: { x: number; y: number; text: string } | null;
  reviews: boolean;
  state: "running" | "queued" | "idle";
  count: number;
}

export interface OrgLayout<T extends OrgBot> {
  width: number;
  height: number;
  lead: (PlacedBot<T> & { cx: number }) | null;
  blocks: OrgBlock<T>[];
  tray: (Rect & { bots: T[]; open: boolean; placed: PlacedBot<T>[] }) | null;
  links: OrgLink[];
  /** Every card and its block, for keyboard moves and the minimap. */
  columns: number;
}

const sum = (list: number[]) => list.reduce((total, value) => total + value, 0);

/** The order a team's bots read top to bottom: a chain of delegation reads
 * down (a sender above who it hands to); bots that hand work to another team
 * come last, nearest the link; a person's own order wins when they arranged. */
export function orderTeamBots<T extends OrgBot>(members: T[], pairs: TeamMapPair[], teamIds: ReadonlySet<string>, personal: string[] = []): T[] {
  if (personal.some((id) => members.some((bot) => bot.id === id))) {
    const rank = new Map(personal.map((id, index) => [id, index]));
    return [...members].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  }
  const ids = new Set(members.map((bot) => bot.id));
  const inTeam = pairs.filter((pair) => ids.has(pair.sourceBotId) && ids.has(pair.targetBotId) && pair.count > 0);
  const crossOut = new Set<string>();
  for (const pair of pairs) if (ids.has(pair.sourceBotId) && !ids.has(pair.targetBotId) && teamIds.has(pair.targetBotId) && pair.count > 0) crossOut.add(pair.sourceBotId);
  const incoming = new Set(inTeam.map((pair) => pair.targetBotId));
  const byId = new Map(members.map((bot) => [bot.id, bot]));
  const name = (id: string) => byId.get(id)!.name;
  const sources = members.filter((bot) => !incoming.has(bot.id))
    .sort((a, b) => Number(crossOut.has(a.id)) - Number(crossOut.has(b.id)) || a.name.localeCompare(b.name));
  const out: T[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(byId.get(id)!);
    for (const next of inTeam.filter((pair) => pair.sourceBotId === id).map((pair) => pair.targetBotId).sort((a, b) => name(a).localeCompare(name(b)))) visit(next);
  };
  for (const source of sources) visit(source.id);
  for (const bot of [...members].sort((a, b) => a.name.localeCompare(b.name))) visit(bot.id);
  return out;
}

function blockHeight(shown: number, more: boolean): number {
  if (shown === 0) return HEAD_H + CARD_H + PAD;
  return HEAD_H + shown * CARD_H + (shown - 1) * CARD_GAP + PAD + (more ? CARD_GAP + MORE_H : 0);
}

/** Columns in the order they sit from the middle out: 3 gives 1,0,2; 4 gives 1,2,0,3. */
export function centreOut(columns: number): number[] {
  const order: number[] = [];
  const left = Math.floor((columns - 1) / 2);
  const right = columns % 2 === 0 ? left + 1 : left;
  let l = left, r = right;
  if (columns % 2 === 1) { order.push(left); l -= 1; r += 1; }
  while (l >= 0 || r < columns) {
    if (l >= 0) { order.push(l); l -= 1; }
    if (r < columns) { order.push(r); r += 1; }
  }
  return order;
}

export function layoutOrgChart<T extends OrgBot>(sections: OrgSection<T>[], options: OrgOptions): OrgLayout<T> {
  const columns = Math.max(3, Math.min(5, Math.floor(options.columns)));
  const expanded = options.expanded ?? new Set<string>();
  const pairs = options.pairs.filter((pair) => pair.count > 0);
  const allBots = sections.flatMap((section) => [...section.chiefs, ...section.members]);
  const lead = options.leadId ? allBots.find((bot) => bot.id === options.leadId) ?? null : null;
  const teamOf = new Map<string, string>();
  for (const section of sections) for (const bot of [...section.chiefs, ...section.members]) teamOf.set(bot.id, section.key);
  const teams = sections.filter((section) => section.key !== "");
  const tray = sections.find((section) => section.key === "") ?? null;
  const trayBots = tray ? [...tray.chiefs, ...tray.members].filter((bot) => bot.id !== lead?.id) : [];
  const leadTeam = lead ? teamOf.get(lead.id) ?? "" : "";

  // Team-to-team handoff volume.
  const volume = new Map<string, number>();
  const volumeKey = (from: string, to: string) => `${from}\u0000${to}`;
  for (const pair of pairs) {
    const from = teamOf.get(pair.sourceBotId), to = teamOf.get(pair.targetBotId);
    if (from === undefined || to === undefined || from === to) continue;
    volume.set(volumeKey(from, to), (volume.get(volumeKey(from, to)) ?? 0) + pair.count);
  }
  const fromLead = new Map<string, number>();
  if (lead) for (const pair of pairs) if (pair.sourceBotId === lead.id) {
    const to = teamOf.get(pair.targetBotId);
    if (to !== undefined && to !== "") fromLead.set(to, (fromLead.get(to) ?? 0) + pair.count);
  }

  // Order inside each team (needs the team ids to find hand-offs out of it).
  const teamIds = new Set(allBots.map((bot) => bot.id));
  const orderedOf = new Map<string, T[]>();
  for (const section of teams) {
    const members = [...section.chiefs, ...section.members].filter((bot) => bot.id !== lead?.id);
    orderedOf.set(section.key, orderTeamBots(members, pairs, teamIds, options.personalOrder?.(section.key)));
  }

  // Tier 0: the teams the lead hands work to, busiest in the middle.
  const keys = teams.map((section) => section.key);
  const tier0Candidates = keys
    .filter((key) => fromLead.has(key) || (lead && key === leadTeam))
    .sort((a, b) => (b === leadTeam ? 1 : 0) - (a === leadTeam ? 1 : 0) || (fromLead.get(b) ?? 0) - (fromLead.get(a) ?? 0) || a.localeCompare(b));
  let roots = tier0Candidates;
  if (!lead) {
    const out = (key: string) => sum(keys.map((other) => volume.get(volumeKey(key, other)) ?? 0));
    const inn = (key: string) => sum(keys.map((other) => volume.get(volumeKey(other, key)) ?? 0));
    roots = keys.filter((key) => out(key) > 0 && inn(key) === 0).sort((a, b) => out(b) - out(a) || a.localeCompare(b));
  }
  const grid = new Map<string, { key: string; tier: number; col: number }>();
  const cell = (tier: number, col: number) => `${tier}:${col}`;
  const placed = new Map<string, { tier: number; col: number }>();
  const put = (key: string, tier: number, col: number) => { grid.set(cell(tier, col), { key, tier, col }); placed.set(key, { tier, col }); };
  const nearestFree = (tier: number, preferred: number): number | null => {
    for (let d = 0; d < columns; d += 1) {
      for (const col of d === 0 ? [preferred] : [preferred - d, preferred + d]) {
        if (col >= 0 && col < columns && !grid.has(cell(tier, col))) return col;
      }
    }
    return null;
  };
  const place = (key: string, tier: number, preferred: number) => {
    for (let at = tier; at < tier + 40; at += 1) {
      const col = nearestFree(at, preferred);
      if (col !== null) { put(key, at, col); return; }
    }
  };
  const middle = centreOut(columns);
  roots.slice(0, columns).forEach((key, index) => put(key, 0, middle[index]));
  roots.slice(columns).forEach((key) => place(key, 1, middle[0]));
  // Teams fed by a placed team sit under it, the biggest feeder first.
  const waiting = () => keys.filter((key) => !placed.has(key));
  for (let guard = 0; guard < keys.length + 1; guard += 1) {
    const candidates = waiting()
      .map((key) => {
        const feeders = [...placed.keys()].map((from) => ({ from, count: volume.get(volumeKey(from, key)) ?? 0 })).filter((feeder) => feeder.count > 0);
        return { key, best: feeders.sort((a, b) => b.count - a.count || a.from.localeCompare(b.from))[0] };
      })
      .filter((candidate) => candidate.best)
      .sort((a, b) => b.best!.count - a.best!.count || a.key.localeCompare(b.key));
    const next = candidates[0];
    if (!next) break;
    const parent = placed.get(next.best!.from)!;
    place(next.key, parent.tier + 1, parent.col);
  }
  // The rest has no link: it fills the free cells under the first row, left first.
  for (const key of waiting()) {
    let done = false;
    for (let tier = 1; !done && tier < 60; tier += 1) {
      for (let col = 0; col < columns; col += 1) {
        if (!grid.has(cell(tier, col))) { put(key, tier, col); done = true; break; }
      }
    }
  }

  // Sizes and positions.
  const contentW = columns * BLOCK_W + (columns - 1) * GAP_X;
  const width = contentW + MARGIN_X * 2;
  const leadTop = MARGIN_TOP;
  const tier0Top = lead ? leadTop + LEAD_H + LANE : MARGIN_TOP;
  const blocks: OrgBlock<T>[] = [];
  const sectionByKey = new Map(teams.map((section) => [section.key, section]));
  const tiersUsed = Math.max(0, ...[...placed.values()].map((slot) => slot.tier)) + 1;
  const tierBase = new Map<number, number>([[0, tier0Top]]);
  for (let tier = 0; tier < tiersUsed; tier += 1) {
    const inTier = [...placed.entries()].filter(([, slot]) => slot.tier === tier).sort((a, b) => a[1].col - b[1].col);
    const base = tierBase.get(tier) ?? tier0Top;
    for (const [key, slot] of inTier) {
      const section = sectionByKey.get(key)!;
      const ordered = orderedOf.get(key) ?? [];
      const open = expanded.has(key);
      const shown = open ? ordered : ordered.slice(0, SHOW);
      const more = ordered.length > SHOW;
      const h = blockHeight(shown.length, more);
      const x = MARGIN_X + slot.col * (BLOCK_W + GAP_X);
      const above = blocks.filter((other) => other.col === slot.col && other.tier < tier).sort((a, b) => b.y - a.y)[0];
      const y = Math.max(base, above ? above.y + above.h + GAP_Y : base);
      const bots = shown.map((bot, index) => ({ bot, x: x + PAD, y: y + HEAD_H + index * (CARD_H + CARD_GAP), w: BLOCK_W - PAD * 2, h: CARD_H }));
      blocks.push({
        key, name: section.name, ...(section.parent ? { parent: section.parent } : {}), col: slot.col, tier, x, y, w: BLOCK_W, h, bots,
        total: ordered.length, hidden: Math.max(0, ordered.length - shown.length), expanded: open && more,
        moreY: y + h - PAD - MORE_H, ordered,
      });
    }
    const tierBlocks = blocks.filter((block) => block.tier === tier);
    if (tierBlocks.length) tierBase.set(tier + 1, Math.min(...tierBlocks.map((block) => block.y + block.h)) + GAP_Y);
    else tierBase.set(tier + 1, base);
  }

  const bottom = blocks.length ? Math.max(...blocks.map((block) => block.y + block.h)) : tier0Top;
  let trayRect: OrgLayout<T>["tray"] = null;
  if (trayBots.length > 0 || (tray && tray.members.length + tray.chiefs.length > 0)) {
    const perRow = columns;
    const rows = Math.ceil(trayBots.length / perRow);
    const open = Boolean(options.trayOpen) && trayBots.length > 0;
    const tw = contentW;
    const cardW = (tw - PAD * 2 - (perRow - 1) * 10) / perRow;
    const h = open ? HEAD_H + rows * CARD_H + (rows - 1) * 10 + PAD + 4 : TRAY_H;
    const y = bottom + TRAY_GAP;
    const placedTray = open ? trayBots.map((bot, index) => ({ bot, x: MARGIN_X + PAD + (index % perRow) * (cardW + 10), y: y + HEAD_H + Math.floor(index / perRow) * (CARD_H + 10), w: cardW, h: CARD_H })) : [];
    trayRect = { x: MARGIN_X, y, w: tw, h, bots: trayBots, open, placed: placedTray };
  }
  const height = (trayRect ? trayRect.y + trayRect.h : bottom) + MARGIN_BOTTOM;
  const leadRect = lead ? { bot: lead, x: MARGIN_X + (contentW - BLOCK_W) / 2, y: leadTop, w: BLOCK_W, h: LEAD_H, cx: MARGIN_X + contentW / 2 } : null;

  // Links.
  const links: OrgLink[] = [];
  const blockByKey = new Map(blocks.map((block) => [block.key, block]));
  const obstacles = (skip: string[]) => blocks.filter((block) => !skip.includes(block.key));
  const hits = (segments: Array<[number, number, number, number]>, skip: string[]) =>
    segments.some(([x1, y1, x2, y2]) => obstacles(skip).some((block) => {
      const left = Math.min(x1, x2), right = Math.max(x1, x2), top = Math.min(y1, y2), bottomY = Math.max(y1, y2);
      return right > block.x - 4 && left < block.x + block.w + 4 && bottomY > block.y - 4 && top < block.y + block.h + 4;
    }));
  const stateOf = (list: TeamMapPair[]): OrgLink["state"] => list.some((pair) => pair.live === "running") ? "running" : list.some((pair) => pair.live === "queued") ? "queued" : "idle";

  // Lead to the teams it hands work to (the first row only).
  if (leadRect) {
    const busY = leadRect.y + LEAD_H + LANE / 2;
    for (const block of blocks.filter((item) => item.tier === 0)) {
      const count = fromLead.get(block.key) ?? 0;
      if (count <= 0) continue;
      const list = pairs.filter((pair) => pair.sourceBotId === lead!.id && teamOf.get(pair.targetBotId) === block.key);
      const cx = block.x + block.w / 2;
      const straight = Math.abs(cx - leadRect.cx) < 1;
      const path = straight ? `M${leadRect.cx} ${leadRect.y + LEAD_H}V${block.y - 2}` : `M${leadRect.cx} ${leadRect.y + LEAD_H}V${busY - 12}Q${leadRect.cx} ${busY} ${leadRect.cx + Math.sign(cx - leadRect.cx) * 12} ${busY}H${cx - Math.sign(cx - leadRect.cx) * 12}Q${cx} ${busY} ${cx} ${busY + 12}V${block.y - 2}`;
      links.push({
        id: `lead:${block.key}`, kind: "lead", fromKey: leadTeam, toKey: block.key, path, end: { x: cx, y: block.y - 1, angle: 90 },
        badge: { x: cx, y: block.y - 16, text: String(count) }, reviews: list.every((pair) => pair.kind === "reviews"), state: stateOf(list), count,
      });
    }
  }

  // Team to team, from the bottom of the sender to the top of the receiver.
  const teamPairs = new Map<string, TeamMapPair[]>();
  for (const pair of pairs) {
    if (lead && pair.sourceBotId === lead.id) continue;
    const from = teamOf.get(pair.sourceBotId), to = teamOf.get(pair.targetBotId);
    if (!from || !to || from === to) continue;
    teamPairs.set(volumeKey(from, to), [...(teamPairs.get(volumeKey(from, to)) ?? []), pair]);
  }
  for (const [pairKey, list] of teamPairs) {
    const [fromKey, toKey] = pairKey.split("\u0000");
    const a = blockByKey.get(fromKey), b = blockByKey.get(toKey);
    if (!a || !b) continue;
    const count = sum(list.map((pair) => pair.count));
    const reviews = list.every((pair) => pair.kind === "reviews");
    const down = b.y >= a.y + a.h;
    const up = a.y >= b.y + b.h;
    let path = "";
    let end = { x: 0, y: 0, angle: 90 };
    let badge = { x: 0, y: 0 };
    let segs: Array<[number, number, number, number]> = [];
    if (down || up) {
      const [top, low] = down ? [a, b] : [b, a];
      const ax = a.x + a.w / 2, bx = b.x + b.w / 2;
      const y1 = down ? a.y + a.h : a.y, y2 = down ? b.y - 2 : b.y + b.h + 2;
      if (Math.abs(ax - bx) < 1) {
        path = `M${ax} ${y1}V${y2}`; end = { x: ax, y: y2 + (down ? 1 : -1), angle: down ? 90 : -90 }; badge = { x: ax, y: (y1 + y2) / 2 }; segs = [[ax, y1, ax, y2]];
      } else {
        const midY = (top.y + top.h + low.y) / 2;
        const dir = Math.sign(bx - ax);
        path = `M${ax} ${y1}V${midY - 10}Q${ax} ${midY} ${ax + dir * 10} ${midY}H${bx - dir * 10}Q${bx} ${midY} ${bx} ${midY + (down ? 10 : -10)}V${y2}`;
        end = { x: bx, y: y2 + (down ? 1 : -1), angle: down ? 90 : -90 }; badge = { x: (ax + bx) / 2, y: midY };
        segs = [[ax, y1, ax, midY], [ax, midY, bx, midY], [bx, midY, bx, y2]];
      }
    } else {
      // Side by side: across the gap at the height of the title bands.
      const left = a.x < b.x ? a : b, right = a.x < b.x ? b : a;
      const y = Math.max(a.y, b.y) + HEAD_H / 2;
      const aLeft = a.x < b.x;
      path = `M${aLeft ? left.x + left.w : right.x} ${y}H${aLeft ? right.x - 2 : left.x + left.w + 2}`;
      end = { x: aLeft ? right.x - 1 : left.x + left.w + 1, y, angle: aLeft ? 0 : 180 };
      badge = { x: (left.x + left.w + right.x) / 2, y };
      segs = [[left.x + left.w, y, right.x, y]];
    }
    if (hits(segs, [fromKey, toKey])) continue;
    links.push({ id: `team:${pairKey}`, kind: "team", fromKey, toKey, path, end, badge: count > 0 ? { ...badge, text: String(count) } : null, reviews, state: stateOf(list), count });
  }

  // Inside a team: delegation down the left of the cards, reviews (and any
  // pair that is not neighbours) on a bracket at the right.
  for (const block of blocks) {
    const at = new Map(block.bots.map((placedBot) => [placedBot.bot.id, placedBot]));
    const inside = pairs.filter((pair) => at.has(pair.sourceBotId) && at.has(pair.targetBotId));
    let lane = 0;
    for (const pair of inside) {
      const a = at.get(pair.sourceBotId)!, b = at.get(pair.targetBotId)!;
      const neighbours = Math.abs(a.y - b.y) <= CARD_H + CARD_GAP + 1;
      const state = pair.live ?? "idle";
      if (pair.kind === "delegates" && neighbours) {
        const down = b.y > a.y;
        const x = a.x + 24, y1 = down ? a.y + CARD_H : a.y, y2 = down ? b.y : b.y + CARD_H;
        links.push({ id: `bot:${pair.sourceBotId}:${pair.targetBotId}`, kind: "bot", fromKey: block.key, toKey: block.key, fromBot: pair.sourceBotId, toBot: pair.targetBotId,
          path: `M${x} ${y1}V${y2}`, end: { x, y: y2, angle: down ? 90 : -90 }, badge: { x: x + 24, y: (y1 + y2) / 2, text: String(pair.count) }, reviews: false, state, count: pair.count });
      } else {
        const bx = a.x + a.w + 2 + lane * 8;
        const ya = a.y + CARD_H / 2, yb = b.y + CARD_H / 2;
        lane += 1;
        links.push({ id: `bot:${pair.sourceBotId}:${pair.targetBotId}`, kind: "bot", fromKey: block.key, toKey: block.key, fromBot: pair.sourceBotId, toBot: pair.targetBotId,
          path: `M${a.x + a.w} ${ya}H${bx + 8}Q${bx + 12} ${ya} ${bx + 12} ${ya + Math.sign(yb - ya) * 4}V${yb - Math.sign(yb - ya) * 4}Q${bx + 12} ${yb} ${bx + 8} ${yb}H${b.x + b.w}`,
          end: { x: b.x + b.w, y: yb, angle: 180 }, badge: { x: bx + 12, y: (ya + yb) / 2, text: String(pair.count) }, reviews: pair.kind === "reviews", state, count: pair.count });
      }
    }
  }
  return { width, height, lead: leadRect, blocks, tray: trayRect, links, columns };
}

/** Teams the page shows when a search or a filter narrows the map. */
export function botMatches(bot: { name: string; title?: string }, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return bot.name.toLowerCase().includes(needle) || (bot.title ?? "").toLowerCase().includes(needle);
}

/** How many team columns the width allows, 3 to 5. */
export function columnsFor(width: number): number {
  const fit = Math.floor((width - MARGIN_X * 2 + GAP_X) / (BLOCK_W + GAP_X));
  return Math.max(3, Math.min(5, fit));
}
