// @ts-nocheck
/** checkedGroupResponder (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCheckedGroupResponder(getHost: () => Host): any {
function checkedGroupResponder(value: unknown, memberIds: string[]): GroupDefaultResponder | null {
  const host = getHost();
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const responder = value as { kind?: unknown; botId?: unknown; fallbackBotId?: unknown };
  if (responder.kind === "everyone") return { kind: "everyone" };
  if (responder.kind === "mentions") return { kind: "mentions" };
  if (responder.kind === "auto") {
    if (responder.fallbackBotId === undefined || responder.fallbackBotId === null) return { kind: "auto" };
    return typeof responder.fallbackBotId === "string" && memberIds.includes(responder.fallbackBotId)
      ? { kind: "auto", fallbackBotId: responder.fallbackBotId }
      : null;
  }
  if (
    responder.kind === "member" &&
    typeof responder.botId === "string" &&
    memberIds.includes(responder.botId)
  ) {
    return { kind: "member", botId: responder.botId };
  }
  return null;
}
  return checkedGroupResponder;
}
