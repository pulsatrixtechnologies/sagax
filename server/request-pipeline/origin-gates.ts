/** originGates (#1388). Pure move from server/index.ts. */
import { INTERIM_SIGNIN_REFUSAL } from "../auth/oidc-login.ts";
import { HOSTED_CONTRACT_HEADER, HOSTED_CONTRACT_METADATA, HOSTED_CONTRACT_VERSION } from "../hosted-contract.ts";
import { HOSTED_MODEL_POLICY_HEADER } from "../models/hosted-models.ts";
import { PUBLIC_INVITE_PATH } from "../org/org-routes.ts";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface OriginGatesDeps {
  HOSTED_WORKSPACE: boolean;
  IDENTITY: { kind: string };
  PAGES_ORIGIN: any;
  handlePagesOriginRequest(...args: any[]): any;
  hostedAccessEntitled(...args: any[]): any;
  hostedModels: any;
  hostedWorkspaceConfiguration(...args: any[]): any;
  inboundMail(...args: any[]): any;
  inboundTelephony(...args: any[]): any;
  perspicaxEvents(...args: any[]): any;
  isInterimSignInRoute(...args: any[]): any;
  isLoopbackHost(...args: any[]): any;
  isProxied(...args: any[]): any;
  json: any;
  managedPolicy: any;
  oidcLogin: any;
  orgAdmin(...args: any[]): any;
  orgLink(...args: any[]): any;
  orgMember(...args: any[]): any;
  publishedPageOptions(...args: any[]): any;
  securityKeyCeremonies(...args: any[]): any;
  workspaceAccess: any;
}

export function createOriginGates(getHost: () => OriginGatesDeps) {
async function originGates(req: IncomingMessage, res: ServerResponse, url: URL, path: string, method: string): Promise<boolean> {
  const host = getHost();
  
  // The separate pages origin (SAGAX_PAGES_ORIGIN) serves the published
  // pages' frames and nothing else: before any other route or credential.
  if (host.PAGES_ORIGIN && host.handlePagesOriginRequest(host.publishedPageOptions(), req, res, path, method)) return true;
  // Unlike the legacy reachability probe, this attests the running
  // server's portal-membership capability, including the layer's live
  // entitlement (never the open-source edition's own features).
  if (method === "GET" && path === "/api/health/hosted") {
    res.setHeader("cache-control", "no-store");
    const hosted = host.hostedWorkspaceConfiguration();
    if (!hosted?.portalMembership || !host.workspaceAccess || !host.hostedAccessEntitled()) {
      host.json(res, 503, { error: "Hosted workspace readiness is unavailable." });
      return true;
    }
    res.setHeader(HOSTED_CONTRACT_HEADER, String(HOSTED_CONTRACT_VERSION));
    if (host.hostedModels) res.setHeader(HOSTED_MODEL_POLICY_HEADER, "1");
    host.json(res, 200, { ok: true, service: "openmausbot", membershipAuthority: "portal", workspace: hosted.workspace, ...HOSTED_CONTRACT_METADATA });
    return true;
  }
  // Slice 7: the console's admin API, before every other credential: a
  // console assertion only, never a session cookie or loopback trust.
  if (await host.orgAdmin(req, res, url)) return true;
  // 2026-10-09: the member API, same credential rule: an assertion only.
  if (await host.orgMember(req, res, url)) return true;
  // 2026-10-21: bot inbound mail from the Perspicax relay, same rule.
  if (await host.inboundMail(req, res, url)) return true;
  // 2026-10-26: bot phone events from Perspicax Voice, same rule.
  if (await host.inboundTelephony(req, res, url)) return true;
  // #4250: product events from the organization server, same rule.
  if (await host.perspicaxEvents(req, res, url)) return true;
  // 2026-10-11: Perspicax's link routes, the link token only.
  if (await host.orgLink(req, res, url)) return true;
  // 2026-10-16: a security key ceremony, its own id only (server/routes/security-keys.ts).
  if (await host.securityKeyCeremonies(req, res, url)) return true;
  // An organization server signs people in with Pulsatrix only: the
  // interim email codes and invitation links are refused outright.
  if (host.IDENTITY.kind === "perspicax") {
    if (host.isInterimSignInRoute(method, path)) {
      host.json(res, 403, INTERIM_SIGNIN_REFUSAL);
      return true;
    }
    // The old invitation page sends its visitors to the sign-in page.
    if (method === "GET" && (path === "/join" || path === "/join/")) {
      res.writeHead(302, { location: "/pair", "cache-control": "no-store" });
      res.end();
      return true;
    }
    if (host.oidcLogin && await host.oidcLogin(req, res, url)) return true;
  }
  // Hosted workspaces have one sign-in authority. A missing optional layer
  // must not accidentally reactivate legacy email/QR credential minting.
  if (host.HOSTED_WORKSPACE) {
    if ((method === "POST" && ["/api/auth/pair", "/api/pair", "/api/auth/pairing", "/api/auth/email/start", "/api/auth/email/verify"].includes(path)) || PUBLIC_INVITE_PATH.test(path)) {
      host.json(res, 403, { error: "Sign in through the workspace portal." });
      return true;
    }
    if (host.workspaceAccess) {
      if (await host.workspaceAccess.handlePublic(req, res, url)) return true;
    } else if (path.startsWith("/api/auth/hosted/") || path === "/pair" || (path === "/" && (!host.isLoopbackHost(req.headers.host) || host.isProxied(req)))) {
      host.json(res, 503, { error: "Workspace sign-in is unavailable." });
      return true;
    }
  }
  // An enrolled organisation that turns remote access off refuses new pairing
  // codes and new remote sessions. Existing sessions and this app are unchanged.
  if (method === "POST" && (["/api/auth/pair", "/api/pair", "/api/auth/pairing", "/api/auth/email/start", "/api/auth/email/verify"].includes(path) || PUBLIC_INVITE_PATH.test(path))) {
    const refusal = host.managedPolicy.remoteAccessRefusal();
    if (refusal) {
      host.json(res, 403, { error: refusal, code: "managed_policy" });
      return true;
    }
  }
  return false;
}

  return originGates;
}
