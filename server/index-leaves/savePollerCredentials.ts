// @ts-nocheck
/** savePollerCredentials (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSavePollerCredentials(getHost: () => Host): any {
function savePollerCredentials(id: string, credentials: { password?: string; url?: string }) {
  const host = getHost();

  const poller = host.webhooks.automationTargetFor(id)?.source.poller;
  if (!poller) throw Object.assign(new Error("Only a trigger with a poller takes a password or link"), { status: 400 });
  if (credentials.url && poller.kind !== "ics") throw Object.assign(new Error("Only an ICS calendar takes a private link"), { status: 400 });
  if (credentials.password && poller.kind === "ics") throw Object.assign(new Error("An ICS calendar takes its private link, not a password"), { status: 400 });
  host.triggerPollerCredentials.set(id, credentials);
  host.webhooks.touch(id);
  const target = host.webhooks.automationTargetFor(id);
  if (target?.enabled) void host.triggerPollers?.poll(id);

}
  return savePollerCredentials;
}
