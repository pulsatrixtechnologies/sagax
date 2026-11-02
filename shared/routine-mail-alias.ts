/** A routine's mail tag: the part after + on the bot's address
 * (local+tag@domain). Letters and digits only, so it cannot change the
 * domain or add another recipient. */
const TAG = /^[a-z0-9]{1,32}$/;

export function parseMailAlias(value: unknown): { ok: true; alias?: string } | { ok: false; error: string } {
  if (value == null || value === "") return { ok: true };
  if (typeof value !== "string") return { ok: false, error: "A mail tag is 1 to 32 letters or digits." };
  const alias = value.trim().toLowerCase();
  if (!TAG.test(alias)) return { ok: false, error: "A mail tag is 1 to 32 letters or digits." };
  return { ok: true, alias };
}

/** The tag on local+tag@domain, or null when the address has none or the
 * tag is not one this app stores. */
export function plusTag(address: string): string | null {
  const at = address.lastIndexOf("@");
  const local = (at === -1 ? address : address.slice(0, at)).trim().toLowerCase();
  const plus = local.indexOf("+");
  if (plus < 1) return null;
  const tag = local.slice(plus + 1);
  return TAG.test(tag) ? tag : null;
}

/** local+tag@domain when the bot address is a single address without a tag
 * of its own. Null when it cannot be built. This does not send mail: the
 * connector still sends from its own address. */
export function routineMailAddress(botAddress: string, alias: string): string | null {
  const parsed = parseMailAlias(alias);
  if (!parsed.ok || !parsed.alias) return null;
  const trimmed = botAddress.trim();
  const at = trimmed.lastIndexOf("@");
  if (at < 1 || trimmed.includes("+") || /[\s,;]/.test(trimmed)) return null;
  const domain = trimmed.slice(at + 1);
  if (!domain.includes(".")) return null;
  return `${trimmed.slice(0, at)}+${parsed.alias}@${domain}`;
}

/** A routine row used to route inbound mail by plus tag. */
export interface MailTagRoutine {
  id: string;
  botId: string;
  name?: string;
  enabled: boolean;
  suspended?: boolean;
  mailAlias?: string;
}

/** Enabled, unsuspended routines of this bot bound to the plus tag. */
export function routinesForMailTag(
  routines: readonly MailTagRoutine[],
  botId: string,
  tag: string,
): MailTagRoutine[] {
  const wanted = tag.trim().toLowerCase();
  if (!TAG.test(wanted)) return [];
  return routines.filter((routine) =>
    routine.botId === botId
    && routine.enabled
    && !routine.suspended
    && routine.mailAlias === wanted);
}

export type MailDeliveryPlan =
  | { kind: "tagged"; tag: string; routineIds: string[] }
  | { kind: "untagged" };

/** Tagged To addresses wake only the matching mailAlias routines. The plain
 * bot address keeps today's botmail typed triggers. */
export function planMailDelivery(
  toAddress: string,
  routines: readonly MailTagRoutine[],
  botId: string,
): MailDeliveryPlan {
  const tag = plusTag(toAddress);
  if (!tag) return { kind: "untagged" };
  return {
    kind: "tagged",
    tag,
    routineIds: routinesForMailTag(routines, botId, tag).map((routine) => routine.id),
  };
}

export interface TagRoutingRow {
  tag: string;
  address: string | null;
  routineId: string;
  routineName: string;
  /** False when the routine is paused or suspended. */
  enabled: boolean;
}

/** Settings UI rows: every routine of this bot that has a mail tag. Another
 * bot's routines never appear. */
export function tagRoutingRows(
  routines: readonly MailTagRoutine[],
  botId: string,
  botAddress: string | null | undefined,
): TagRoutingRow[] {
  const address = typeof botAddress === "string" ? botAddress.trim() : "";
  const rows: TagRoutingRow[] = [];
  for (const routine of routines) {
    if (routine.botId !== botId || !routine.mailAlias) continue;
    rows.push({
      tag: routine.mailAlias,
      address: address ? routineMailAddress(address, routine.mailAlias) : null,
      routineId: routine.id,
      routineName: routine.name?.trim() || routine.id,
      enabled: routine.enabled && !routine.suspended,
    });
  }
  return rows;
}
