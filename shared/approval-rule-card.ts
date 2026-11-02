// 2026-10-19 ("On doit avoir des cartes, mais avoir la possibilité de
// faire TOUJOURS le Toujours permettre"): which cards also offer Always deny.
// Every card with a rule scope (`ownerRule`) offers Always allow; Always deny
// is a rule of an engine's own tool calls only. An admin's card, an act or a
// setting change, a widget's change, a send on the person's behalf, a held
// action or a proposal keeps Always allow only: a deny there would answer
// nothing (server/index.ts keptCardRule matches allow rules only).

export interface RuleCardLike {
  ownerRule?: { from?: "admin" | "hold" | "origin" } | undefined;
  botActRequest?: unknown;
  cwActionRequest?: unknown;
  outboundRequest?: unknown;
  routineRequest?: unknown;
  profileRequest?: unknown;
  modelRequest?: unknown;
  ruleRequest?: unknown;
  skillRequest?: unknown;
  terminalRequest?: unknown;
  heldCode?: string;
}

export function alwaysDenyOffered(card: RuleCardLike): boolean {
  if (!card.ownerRule || card.ownerRule.from === "admin") return false;
  return !(card.botActRequest || card.cwActionRequest || card.outboundRequest || card.routineRequest || card.profileRequest || card.modelRequest || card.ruleRequest || card.skillRequest || card.terminalRequest
    || card.heldCode === "approval.held.native");
}
