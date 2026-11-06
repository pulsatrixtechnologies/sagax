// @ts-nocheck
/** viewerForApproval (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createViewerForApproval(getHost: () => Host): any {
function viewerForApproval(auth: RequestAuth) {
  const host = getHost();
  const { channelViewerId } = host;

  const userId = auth.kind === "session"
    ? (channelViewerId(auth) ?? "")
    : auth.kind === "loopback" && auth.trust !== "service"
      ? host.localPrincipalId()
      : "";
  return {
    userId,
    deviceId: host.registeredDeviceFor({ sessionId: auth.kind === "session" ? auth.session.id : undefined, userId })
  };

}
  return viewerForApproval;
}
