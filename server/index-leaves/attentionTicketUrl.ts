// @ts-nocheck
/** attentionTicketUrl (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAttentionTicketUrl(getHost: () => Host): any {
function attentionTicketUrl(threadId: string, ticketId: number) {
  const host = getHost();

  let site = cwSiteFromEnv();
  if (!site) {
    for (const message of host.store.messagesFor(threadId).slice(-400).reverse()) {
      if (!message.tool?.widget) continue;
      const found = host.CW_OPEN_RECORD.exec(JSON.stringify(message.tool.widget));
      if (found) { site = host.cwSite(found[1], found[2]); if (site) break; }
    }
  }
  return host.cwRecordLink(site, "ServiceFv", ticketId);

}
  return attentionTicketUrl;
}
