// The routes a person's session may NOT use for themselves (#4471), each with
// its reason. Everything a person does for themselves and their own bots is
// in CLIENT_ALLOW (client-allow.ts); what a permission opens is in
// PERMISSION_ROUTES (request-auth.ts). A route stays here only when it really
// reaches other people, the whole organization, the shared server or its
// billing, or when a person's session is not how it is opened at all.
//
// server/auth/route-scopes.test.ts holds every route of the server to one of
// the three lists: a new route that nobody classed fails there instead of
// silently refusing members with an admin-only answer.

export interface HeldRoute {
  methods: readonly string[];
  path: RegExp;
  /** The app's sentence for this refusal (src/locales, en and fr): the app
   * shows it in the person's language. route-scopes.test.ts holds its
   * English to `${ADMIN_ONLY_PREFIX}: ${reserved}.` */
  key: string;
  /** Plain words for the person who is refused: what is reserved, and why. */
  reserved: string;
}

const ALL = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** Reserved to an administrator: the action reaches beyond the person. */
export const ADMIN_ROUTES: readonly HeldRoute[] = [
  { methods: ALL, path: /^\/api\/admin(?:\/|$)/, key: "serverError.adminRoute.adminPages", reserved: "the organization's administration pages act on every person's pages, sessions and settings" },
  { methods: ALL, path: /^\/api\/org(?:\/|$)/, key: "serverError.adminRoute.orgSettings", reserved: "the organization's settings, people, invitations, sections and shared secrets apply to everyone in it" },
  { methods: ALL, path: /^\/api\/org-library(?:\/|$)/, key: "serverError.adminRoute.orgLibrary", reserved: "the organization's library is what every person sees and installs" },
  { methods: ALL, path: /^\/api\/team-library\/(?:catalog|github|teams\/[a-z0-9-]+)$/, key: "serverError.adminRoute.teamLibrary", reserved: "the shared team library is what every person sees and installs" },
  { methods: ALL, path: /^\/api\/teams\/(?:scout(?:\/directory)?|import-plugin)$/, key: "serverError.adminRoute.teamLibraryImport", reserved: "importing into the shared team library changes it for everyone" },
  { methods: ALL, path: /^\/api\/section-context$/, key: "serverError.adminRoute.sectionContext", reserved: "a section's shared brief is read by every bot of that section" },
  { methods: ALL, path: /^\/api\/template-links(?:\/|$)/, key: "serverError.adminRoute.templateLinks", reserved: "a template link is public and is built from this server's New bot defaults, which everyone starts from" },
  { methods: ALL, path: /^\/api\/moderation\/reports(?:\/|$)/, key: "serverError.adminRoute.moderationReports", reserved: "reports are about other people's messages" },
  { methods: ALL, path: /^\/api\/fleet(?:\/|$)/, key: "serverError.adminRoute.fleet", reserved: "the fleet is every installation this one manages" },
  { methods: ALL, path: /^\/api\/decisions(?:\.csv)?$/, key: "serverError.adminRoute.decisions", reserved: "the decision log covers every person's requests on this server" },
  { methods: ALL, path: /^\/api\/tool-grants(?:\/|$)/, key: "serverError.adminRoute.toolGrants", reserved: "these tool grants apply across the whole server (your own are under your settings)" },
  { methods: ALL, path: /^\/api\/instances(?:\/|$)/, key: "serverError.adminRoute.instances", reserved: "the server's engines are shared by everyone on it (your own accounts are under your settings)" },
  { methods: ["DELETE"], path: /^\/api\/bot-presets\/[\w-]+$/, key: "serverError.adminRoute.botPresets", reserved: "the bot presets are what everyone starts a new bot from" },
  { methods: ALL, path: /^\/api\/settings\/custom-domain$/, key: "serverError.adminRoute.customDomain", reserved: "the server's address is in every pairing and invitation link" },
  { methods: ALL, path: /^\/api\/workspace-backup\/restore$/, key: "serverError.adminRoute.workspaceRestore", reserved: "a restore replaces the whole installation, everyone's bots and conversations included" },
  { methods: ["PUT"], path: /^\/api\/me\/spend-cap$/, key: "serverError.adminRoute.spendCap", reserved: "this server's monthly spend limit counts every bot on it" },
  { methods: ALL, path: /^\/api\/(?:mac-apps|messages)(?:\/|$)/, key: "serverError.adminRoute.macApps", reserved: "the Apple apps belong to the Mac the server runs on" },
  { methods: ALL, path: /^\/api\/live(?:\/|$)/, key: "serverError.adminRoute.live", reserved: "a Live call runs one at a time on the machine the server runs on, for everyone" },
  { methods: ALL, path: /^\/api\/(?:bots\/[\w-]+\/)?local-computer(?:\/|$)/, key: "serverError.adminRoute.localComputer", reserved: "the local computer is a container on the machine the server itself runs on" },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/computer\/(?:provision|sleep|exec|remove)$/, key: "serverError.adminRoute.cloudComputer", reserved: "the cloud computer is created and paid for on this server's own account" },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/memory\/open$/, key: "serverError.adminRoute.memoryOpen", reserved: "it opens a folder on the computer the server runs on" },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/messages\/guarded$/, key: "serverError.adminRoute.guardedSend", reserved: "a relay's send books the turn to the person it names, who may be someone else (your own messages go through the chat)" },
  { methods: ALL, path: /^\/api\/desktop-viewer\/local\//, key: "serverError.adminRoute.localDesktops", reserved: "these desktops belong to the machine the server runs on" },
];

/** Not opened by a person's session at all: their own token, a code or a
 * signed link is the authorization, they are answered before sign-in, or
 * they serve only the desktop app on this machine. A session that reaches
 * one is refused the way an admin route refuses it. */
export const OTHER_AUTH_ROUTES: readonly HeldRoute[] = [
  { methods: ALL, path: /^\/api\/internal(?:\/|$)/, key: "serverError.adminRoute.botToken", reserved: "it is a bot's own route, opened by the bot's capability token, not by a person" },
  { methods: ALL, path: /^\/api\/testing(?:\/|$)/, key: "serverError.adminRoute.testing", reserved: "it is a test route that exists only with its private key" },
  { methods: ALL, path: /^\/api\/(?:auth\/(?:email\/(?:start|verify)|hosted\/[\w/-]*|pair)|pair|org\/invites\/[^/]+\/(?:preview|join))$/, key: "serverError.adminRoute.beforeSignIn", reserved: "it is answered before sign-in: the code or the link is the authorization" },
  { methods: ALL, path: /^\/api\/(?:health\/hosted|mcp-oauth\/callback|media\/proxy\/[^/]+|bridge\/grok\/[a-f0-9]{32}|security-keys\/ceremony\/[^/]+(?:\/page|\/status)?)$/, key: "serverError.adminRoute.signedToken", reserved: "it is answered before sign-in: its own signed token is the authorization" },
  { methods: ALL, path: /^\/api\/(?:shared-computers\/copy|desktop\/shared-computer-control|machine-runs(?:\/[0-9a-f]{24}\/answer)?)$/, key: "serverError.adminRoute.desktopApp", reserved: "it serves only the desktop app on this computer" },
  { methods: ALL, path: /^\/api\/(?:v1\/models|timedtext)$/, key: "serverError.adminRoute.outbound", reserved: "it is an address this server calls elsewhere, not a route of its own" },
];

function match(list: readonly HeldRoute[], method: string, path: string): HeldRoute | null {
  const upper = method.toUpperCase();
  return list.find((rule) => rule.methods.includes(upper) && rule.path.test(path)) ?? null;
}

/** Why this route is not a person's own, or null when no held list names it. */
export function heldRoute(method: string, path: string): HeldRoute | null {
  return match(ADMIN_ROUTES, method, path) ?? match(OTHER_AUTH_ROUTES, method, path);
}

/** Start of every refusal of a reserved route, in the server's English. */
export const ADMIN_ONLY_PREFIX = "Only an administrator can do this";

/** The code of the gate's own refusal of a reserved route (#4471). A
 * handler's refusal keeps its own code (`admin_only` and others): this one
 * says the route itself is not a person's, which an app reads as "not for
 * you on this server" (src/lib/server-route.ts routeMissingOnServer). */
export const ADMIN_ROUTE_CODE = "admin_route";

/** The answer a person gets on a route that is truly not theirs: plain words,
 * what is reserved and why, and the app's key for the same sentence. */
export function adminOnlyRefusal(method: string, path: string): { error: string; code: typeof ADMIN_ROUTE_CODE; reasonKey?: string } {
  const held = heldRoute(method, path);
  return held
    ? { error: `${ADMIN_ONLY_PREFIX}: ${held.reserved}.`, code: ADMIN_ROUTE_CODE, reasonKey: held.key }
    : { error: `${ADMIN_ONLY_PREFIX} on this server. Ask an administrator if you need it.`, code: ADMIN_ROUTE_CODE };
}
