// #4359: a product the person turned off for one bot (Connect Apps > Manage,
// This bot; shared/bot-products.ts) gives that bot none of its tools. The
// Perspicax relay (PerspicaxMcp.relay, the one path every engine frame and
// every native call takes) applies it, on the server:
//
// - tools/list: the product's tools are left out (so the engine's own tool
//   search never sees them either);
// - tools/call of one of them: refused before Perspicax is called, with the
//   sentence the bot reads (it says so and offers to turn it on);
// - api_search: its results for the product are left out; api_describe and
//   api_lookup on it are refused like a call; api_plan with a step on it too;
// - api_list: the product stays listed, marked `off_for_this_bot`, so the
//   bot can say which products it has and which are off for it.
//
// A family of products (api_list `group`, such as one vendor's endpoints split
// in several products) shares its tools: `<group>_query`, `<group>_write`,
// `<group>_action` and the family's task tools. Their product is found from
// the call with Perspicax's own mapping (api_describe names the `api` of a
// resource or an action, and the `target` of a task tool), never from the
// tool's name.
//
// A Flow action (flow_action) or routine (flow_run) reaches the products its
// own card names: Perspicax's `flow` describe lists an action's tools and
// products, a routine's steps name its tools. The call is refused only when
// one of them is an off product, whatever its family.
//
// `identity` sweeps every served API, or the `apis` it names: an off product
// is taken out of its `apis` (filled with the served products minus the off
// ones when the call names none), a call that names only off products is
// refused, and its answer keeps no row of an off product.
//
// Other bots, the person's products and what the organization serves them
// are untouched: this reads the bot's own switches only.
import { normalProductId, productOfTool } from "../../shared/bot-products.ts";

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** What one bot's turn filters: the products it switched off, and every
 * product id known for it (the off ones included), to find a tool's own. */
export interface BotProductsView {
  off: ReadonlySet<string>;
  known: ReadonlySet<string>;
  /** a product's readable name, for the refusal */
  name?: (id: string) => string | undefined;
  /** the families api_list declares: a group id and its products */
  groups?: ReadonlyMap<string, readonly string[]>;
}

const bareName = (tool: string): string => tool.trim().toLowerCase().replace(/_{2,}/g, "_");

/** The family a tool serves, when no single product owns it. */
export function familyOfTool(view: BotProductsView, tool: string): string | undefined {
  if (!view.groups?.size) return undefined;
  const bare = bareName(tool);
  if (productOfTool(bare, view.known)) return undefined;
  return productOfTool(bare, view.groups.keys());
}

/** What it takes to know whether a family call reaches an off product:
 * nothing (none of the family is off, or the call names no product yet),
 * an answer now (`off`), or Perspicax's mapping of one name (`resolve`). */
export type FamilyCallPlan =
  | { kind: "none" }
  | { kind: "off"; id: string }
  | { kind: "resolve"; group: string; members: readonly string[]; name: string };

export function familyCallPlan(view: BotProductsView, tool: string, args: unknown): FamilyCallPlan {
  if (view.off.size === 0) return { kind: "none" };
  const group = familyOfTool(view, tool);
  const members = group ? view.groups?.get(group) ?? [] : [];
  const offMembers = members.filter((id) => view.off.has(id));
  if (!group || offMembers.length === 0) return { kind: "none" };
  const bare = bareName(tool);
  if (offMembers.length === members.length) return { kind: "off", id: offMembers[0]! };
  const input = isObject(args) ? args : {};
  if (typeof input.api === "string" && members.includes(normalProductId(input.api))) {
    const id = normalProductId(input.api);
    return view.off.has(id) ? { kind: "off", id } : { kind: "none" };
  }
  const verb = bare.slice(group.length + 1);
  const named = verb === "query" || verb === "write" ? input.resource : verb === "action" ? input.action : bare;
  return typeof named === "string" && named.trim() ? { kind: "resolve", group, members, name: named.trim() } : { kind: "none" };
}

/** The products an api_describe answer names among a family's: its `api`, the
 * `api/...` of a task tool's `target`, or the family's apis an ambiguous
 * name is found in. */
export function describedProducts(value: unknown, members: readonly string[]): string[] {
  if (!isObject(value)) return [];
  const own = new Set(members.map(normalProductId));
  const pick = (ids: unknown[]): string[] => [...new Set(ids.filter((id): id is string => typeof id === "string").map(normalProductId).filter((id) => own.has(id)))];
  if (typeof value.api === "string") return pick([value.api]);
  if (typeof value.target === "string") return pick([value.target.split("/")[0]]);
  const details = isObject(value.details) ? value.details : isObject(value.error) && isObject(value.error.details) ? value.error.details : null;
  return details && Array.isArray(details.apis) ? pick(details.apis) : [];
}

/** Perspicax's mapping of one family name to the products it reaches. */
export type FamilyMapping = (group: string, members: readonly string[], name: string) => Promise<string[]>;

/** The Flow action or routine a call runs: flow_action's `name`, flow_run's
 * `routine` (in its `args`, or at the top). Undefined for any other tool, and
 * for a call that names none (a resume or a command of the bot's live run:
 * the run itself was let through by name). */
export function flowTargetOf(tool: string, args: unknown): string | undefined {
  const bare = bareName(tool);
  const input = isObject(args) ? args : {};
  const named = bare === "flow_action" ? input.name : bare === "flow_run" ? (isObject(input.args) && typeof input.args.routine === "string" ? input.args.routine : input.routine) : undefined;
  return typeof named === "string" && named.trim() ? named.trim() : undefined;
}

const NAME_TOKEN = /[a-z][a-z0-9_.-]*/g;

/** What a `flow` describe answer says an action or a routine reaches: the
 * action's `tools` and `products`, a routine's own `tools` and `products` and
 * the tool names its steps cite. Names only, lower case. */
export function flowReachOf(value: unknown): string[] {
  if (!isObject(value)) return [];
  const card = isObject(value.action) ? value.action : isObject(value.routine) ? value.routine : null;
  if (!card) return [];
  const names = new Set<string>();
  for (const key of ["tools", "products"]) {
    for (const name of Array.isArray(card[key]) ? card[key] : []) if (typeof name === "string" && name.trim()) names.add(bareName(name));
  }
  if (card.steps !== undefined) {
    const text = (typeof card.steps === "string" ? card.steps : JSON.stringify(card.steps)).toLowerCase();
    for (const token of text.match(NAME_TOKEN) ?? []) names.add(bareName(token.replace(/[.-]+$/, "")));
  }
  return [...names];
}

const FAMILY_GATEWAY_VERBS = new Set(["query", "write", "action"]);

/** The off product among the names a Flow action or routine reaches: a
 * product's own tool or id, a family task tool by Perspicax's mapping, and a
 * family's shared gateway (`<group>_query`...) or the group itself, which
 * can reach any of its products, as its first off one. */
export async function offProductOfReach(view: BotProductsView, names: readonly string[], mapping: FamilyMapping): Promise<string | undefined> {
  for (const raw of names) {
    const name = bareName(raw);
    const own = offApi(view, name) ?? offProductOfTool(view, name);
    if (own) return own;
    const group = view.groups?.has(name) ? name : familyOfTool(view, name);
    const members = group ? view.groups?.get(group) ?? [] : [];
    const firstOff = members.find((id) => view.off.has(id));
    if (!group || !firstOff) continue;
    if (name === group || FAMILY_GATEWAY_VERBS.has(name.slice(group.length + 1))) return firstOff;
    const off = await offProductOfFamilyCall(view, name, {}, mapping);
    if (off) return off;
  }
  return undefined;
}

/** Perspicax's card of one Flow action or routine (`flow` describe), as the
 * names it reaches, or null when Perspicax could not describe it (it then
 * refuses the run itself). */
export type FlowMapping = (name: string) => Promise<string[] | null>;

/** The off product a family call (a `<group>_` tool, a Flow action or
 * routine, or an api_plan step of one) reaches, by Perspicax's own mapping.
 * A family call whose product the mapping cannot tell while part of its
 * family is off is refused as that off product: the switch holds. */
export async function offProductOfFamilyCall(view: BotProductsView, tool: string, args: unknown, mapping: FamilyMapping, flow?: FlowMapping): Promise<string | undefined> {
  if (view.off.size === 0) return undefined;
  if (bareName(tool) === "api_plan" && isObject(args) && Array.isArray(args.steps)) {
    for (const step of args.steps) {
      if (!isObject(step) || typeof step.tool !== "string") continue;
      const off = await offProductOfFamilyCall(view, step.tool, step.args, mapping, flow);
      if (off) return off;
    }
    return undefined;
  }
  const target = flow ? flowTargetOf(tool, args) : undefined;
  if (target && flow) {
    const reach = await flow(target);
    return reach ? offProductOfReach(view, reach, mapping) : undefined;
  }
  const plan = familyCallPlan(view, tool, args);
  if (plan.kind === "none") return undefined;
  if (plan.kind === "off") return plan.id;
  const reached = await mapping(plan.group, plan.members, plan.name);
  return reached.length ? reached.find((id) => view.off.has(id)) : plan.members.find((id) => view.off.has(id));
}

/** The family task tools of a tools/list that serve an off product. */
export async function offFamilyTools(view: BotProductsView, names: string[], mapping: FamilyMapping): Promise<Set<string>> {
  const hidden = new Set<string>();
  await Promise.all(names.map(async (name) => {
    const plan = familyCallPlan(view, name, {});
    if (plan.kind !== "resolve" || plan.name !== bareName(name)) return;
    if ((await mapping(plan.group, plan.members, plan.name)).some((id) => view.off.has(id))) hidden.add(name);
  }));
  return hidden;
}

/** The off product an api_describe or api_lookup answer is about (its `api`
 * or its task tool's `target`), so describing it is refused like a call. */
export function offProductOfDescribeAnswer(view: BotProductsView, tool: string, body: unknown): string | undefined {
  const bare = bareName(tool);
  if (view.off.size === 0 || (bare !== "api_describe" && bare !== "api_lookup") || !isObject(body) || !isObject(body.result)) return undefined;
  const values: unknown[] = [body.result.structuredContent];
  for (const block of Array.isArray(body.result.content) ? body.result.content : []) {
    if (!isObject(block) || block.type !== "text" || typeof block.text !== "string") continue;
    try { values.push(JSON.parse(block.text)); } catch { /* a sentence */ }
  }
  for (const value of values) {
    if (!isObject(value)) continue;
    const api = typeof value.api === "string" ? value.api : typeof value.target === "string" ? value.target.split("/")[0] : undefined;
    const off = offApi(view, api);
    if (off) return off;
  }
  return undefined;
}

/** The off product a tool belongs to, or undefined. */
export function offProductOfTool(view: BotProductsView, tool: string): string | undefined {
  if (view.off.size === 0) return undefined;
  const id = productOfTool(tool, view.known);
  return id && view.off.has(id) ? id : undefined;
}

const offApi = (view: BotProductsView, api: unknown): string | undefined => {
  if (typeof api !== "string" || !api.trim()) return undefined;
  const id = normalProductId(api);
  return view.off.has(id) ? id : undefined;
};

/** The sentence a bot reads for a call of a product that is off for it. */
export function productOffText(view: BotProductsView, id: string): string {
  const name = view.name?.(id) ?? id;
  return `${name} is off for this bot: the person turned it off in Connect Apps (Manage, This bot), so nothing was run. Tell the person, and offer to turn it on for this bot: ask them with a card (ask_choice), and on yes call sagax_settings set bot.products with {"${id}": true}.`;
}

/** The off product a tools/call names, through the tool itself or, for the
 * naming gateway tools, through its arguments. */
export function offProductOfCall(view: BotProductsView, name: string, args: unknown): string | undefined {
  if (view.off.size === 0) return undefined;
  const direct = offProductOfTool(view, name);
  if (direct) return direct;
  const input = isObject(args) ? args : {};
  const bare = name.replace(/_{2,}/g, "_");
  if (bare === "api_describe" || bare === "api_lookup") {
    const byApi = offApi(view, input.api);
    if (byApi) return byApi;
    const op = typeof input.op_id === "string" ? input.op_id : "";
    return offApi(view, op) ?? (op ? offProductOfTool(view, op) : undefined);
  }
  if (bare === "api_plan" && Array.isArray(input.steps)) {
    for (const step of input.steps) {
      const tool = isObject(step) && typeof step.tool === "string" ? step.tool : "";
      const found = tool ? offProductOfCall(view, tool, isObject(step) ? step.args : undefined) : undefined;
      if (found) return found;
    }
  }
  return undefined;
}

/** What an off product changes in a call's arguments: nothing, a refusal
 * (`off`), or the arguments to send instead. */
export type SweepArgs = { kind: "none" } | { kind: "off"; id: string } | { kind: "args"; args: Json };

/** The arguments of an `identity` sweep (or of an api_plan whose steps run
 * one) without the off products: its `apis` without them, or, when it names
 * none, every product known for this bot but the off ones. */
export function sweepArgsWithoutOff(view: BotProductsView, tool: string, args: unknown): SweepArgs {
  if (view.off.size === 0) return { kind: "none" };
  const input = isObject(args) ? args : {};
  const bare = bareName(tool);
  if (bare === "api_plan" && Array.isArray(input.steps)) {
    let changed = false;
    const steps: unknown[] = [];
    for (const step of input.steps) {
      const next = isObject(step) && typeof step.tool === "string" ? sweepArgsWithoutOff(view, step.tool, step.args) : { kind: "none" as const };
      if (next.kind === "off") return next;
      if (next.kind === "args") changed = true;
      steps.push(next.kind === "args" && isObject(step) ? { ...step, args: next.args } : step);
    }
    return changed ? { kind: "args", args: { ...input, steps } } : { kind: "none" };
  }
  if (bare !== "identity") return { kind: "none" };
  const asked = Array.isArray(input.apis) ? input.apis.filter((api): api is string => typeof api === "string" && api.trim() !== "") : [];
  if (asked.length) {
    const kept = asked.filter((api) => !offApi(view, api));
    if (kept.length === asked.length) return { kind: "none" };
    return kept.length ? { kind: "args", args: { ...input, apis: kept } } : { kind: "off", id: offApi(view, asked[0])! };
  }
  const served = [...view.known].filter((id) => !view.off.has(id));
  return served.length ? { kind: "args", args: { ...input, apis: served } } : { kind: "none" };
}

/** The tool names of a tools/list answer. */
export function listedToolNames(body: unknown): string[] {
  if (!isObject(body) || !isObject(body.result) || !Array.isArray(body.result.tools)) return [];
  return body.result.tools.flatMap((tool) => (isObject(tool) && typeof tool.name === "string" ? [tool.name] : []));
}

/** A tools/list answer without the off products' tools: a product's own, a
 * family's when all of it is off (Flow's when any of it is), and `hidden`,
 * the family task tools the caller found to serve an off product. */
export function withoutOffTools(view: BotProductsView, body: unknown, hidden: ReadonlySet<string> = new Set()): unknown {
  if (view.off.size === 0 || !isObject(body) || !isObject(body.result) || !Array.isArray(body.result.tools)) return body;
  const offTool = (name: string) => hidden.has(name) || offProductOfTool(view, name) !== undefined || familyCallPlan(view, name, {}).kind === "off";
  const tools = body.result.tools.filter((tool) => !(isObject(tool) && typeof tool.name === "string" && offTool(tool.name)));
  return tools.length === body.result.tools.length ? body : { ...body, result: { ...body.result, tools } };
}

/** One naming answer's value, filtered: api_search without the off
 * products' results, identity without their rows, api_list with them
 * marked. */
export function filterNamingValue(view: BotProductsView, tool: string, value: unknown): unknown {
  if (view.off.size === 0 || !isObject(value)) return value;
  const bare = tool.replace(/_{2,}/g, "_");
  if (bare === "identity") {
    let dropped = false;
    const next: Json = { ...value };
    for (const key of ["matches", "lookups", "errors"]) {
      const rows = value[key];
      if (!Array.isArray(rows)) continue;
      const kept = rows.filter((row) => !(isObject(row) && offApi(view, row.api)));
      if (kept.length !== rows.length) {
        next[key] = kept;
        dropped = true;
      }
    }
    return dropped ? next : value;
  }
  if (bare === "api_search" && Array.isArray(value.results)) {
    const results = value.results.filter((result) => !(isObject(result) && (offApi(view, result.api) || (typeof result.tool === "string" && offProductOfTool(view, result.tool)))));
    return results.length === value.results.length ? value : { ...value, results };
  }
  if (bare === "api_list" && Array.isArray(value.apis)) {
    let marked = false;
    const apis = value.apis.map((api) => {
      if (!isObject(api) || !offApi(view, api.id)) return api;
      marked = true;
      return { ...api, off_for_this_bot: true };
    });
    return marked ? { ...value, apis, off_for_this_bot_note: "An API marked off_for_this_bot is a product the person turned off for this bot (Connect Apps, This bot): its tools are not available to you. Offer to turn it on when the work needs it." } : value;
  }
  return value;
}

/** A tools/call answer of a naming tool, filtered in its structured content
 * and in every text block that is JSON. */
export function filterNamingAnswer(view: BotProductsView, tool: string, body: unknown): unknown {
  if (view.off.size === 0 || !isObject(body) || !isObject(body.result)) return body;
  const result = body.result;
  let changed = false;
  const next: Json = { ...result };
  if (result.structuredContent !== undefined) {
    const filtered = filterNamingValue(view, tool, result.structuredContent);
    if (filtered !== result.structuredContent) {
      next.structuredContent = filtered;
      changed = true;
    }
  }
  if (Array.isArray(result.content)) {
    next.content = result.content.map((block) => {
      if (!isObject(block) || block.type !== "text" || typeof block.text !== "string") return block;
      let parsed: unknown;
      try {
        parsed = JSON.parse(block.text);
      } catch {
        return block;
      }
      const filtered = filterNamingValue(view, tool, parsed);
      if (filtered === parsed) return block;
      changed = true;
      return { ...block, text: JSON.stringify(filtered) };
    });
  }
  return changed ? { ...body, result: next } : body;
}
