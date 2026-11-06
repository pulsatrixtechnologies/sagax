// @ts-nocheck
/** broadcastPresence (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createBroadcastPresence(getHost: () => Host): any {
function broadcastPresence(view: PresenceView) {
  const host = getHost();
  const { publicPresence } = host;

  const principal = host.principals.byId(view.principalId);
  const principalId = principal?.id ?? view.principalId;
  const hidden = host.presenceHiddenFor(principalId);
  // everyone of the organization: the public view (offline when hidden)
  host.broadcast({ kind: "presence.changed", people: [{ ...publicPresence(view, hidden), principalId }] });
  // the person's own streams: their real state, for their account row
  host.broadcast({ kind: "presence.changed", audience: principalId, people: [{ ...view, principalId, ...(hidden ? { hidden: true } : {}) }] });

}
  return broadcastPresence;
}
