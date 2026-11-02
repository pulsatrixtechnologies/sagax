// The organization side of the parity fixture (PARITY_ORG=1 in
// fixture-server.mjs): what turns the solo dataset into an organization
// server, so the desktop references can show the screens that exist only
// there (a bot's Sharing and Perspicax tools, Settings > Installations, the
// Slack link of a hosted workspace).
//
// - Identity: OMB_IDENTITY=perspicax against the repository's own stub
//   Perspicax (server/testing/fake-oidc-provider.ts, the one the org e2e
//   tests use), started here on a free loopback port: discovery
//   (/.well-known/openid-configuration), a JWKS with an ES256 key generated
//   at start, authorize (signs the configured person in at once), token
//   (code + PKCE, refresh), revoke, the Pulsa Bot directory with people,
//   teams, avatars and MCP profiles, and the token exchange.
// - The viewer: the real sign-in flow (/auth/oidc/start -> the stub's
//   authorize -> /auth/oidc/callback) run here over HTTP as the placeholder
//   admin "Alex Martin"; the session cookie it mints is what the seeding
//   uses and what the desktop capture puts in its browser.
// - Hosted workspace (portal membership) with a stub enterprise layer that
//   grants every feature, as the product runs with, and authorizes every
//   session: the bot panel's Slack link.
// - A stub fleet agent on a Unix socket (OMB_FLEET_SOCKET): Settings >
//   Installations lists three placeholder client workspaces.
//
// Every name is placeholder; nothing leaves this machine (the hosted and
// admin addresses are under .test and never resolve).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync, crc32 } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PUBLIC_URL = "https://parity-org.example.test";

// ── the people (placeholder) ────────────────────────────────────────────
const PEOPLE = [
  { sub: "01PARITY0ALEXMARTIN0000001", name: "Alex Martin", preferred_username: "alex.martin", email: "alex.martin@example.test", role: "admin", rgb: [88, 120, 210] },
  { sub: "01PARITY0SAMRIVERA00000002", name: "Sam Rivera", preferred_username: "sam.rivera", email: "sam.rivera@example.test", role: "manager", rgb: [210, 120, 80] },
  { sub: "01PARITY0JORDANLEE00000003", name: "Jordan Lee", preferred_username: "jordan.lee", email: "jordan.lee@example.test", role: "employee", rgb: [80, 170, 120] },
  { sub: "01PARITY0TAYLORKIM00000004", name: "Taylor Kim", preferred_username: "taylor.kim", email: "taylor.kim@example.test", role: "employee", rgb: [170, 100, 190] },
  { sub: "01PARITY0MORGANCHEN0000005", name: "Morgan Chen", preferred_username: "morgan.chen", email: "morgan.chen@example.test", role: "employee", rgb: [200, 170, 60] },
  { sub: "01PARITY0CASEYBROOKS000006", name: "Casey Brooks", preferred_username: "casey.brooks", email: "casey.brooks@example.test", role: "employee", rgb: [60, 160, 190], disabled: true },
];
const VIEWER = PEOPLE[0];
const TEAMS = [
  { id: "01PARITYTEAMSERVICEDESK01", name: "Service Desk", managers: [PEOPLE[1].sub], members: [PEOPLE[2].sub, PEOPLE[3].sub] },
  { id: "01PARITYTEAMPROJECTS00002", name: "Projects", managers: [VIEWER.sub], members: [PEOPLE[4].sub] },
];
const PROFILES = [
  { id: "01PARITYPROFILEDISPATCH001", slug: "dispatch", name: "Dispatch", description: "Placeholder: tickets and schedules" },
  { id: "01PARITYPROFILEDOCS0000002", slug: "documentation", name: "Documentation", description: "Placeholder: knowledge base articles" },
  { id: "01PARITYPROFILEBACKUP00003", slug: "backups", name: "Backups", description: "Placeholder: backup jobs and alerts" },
];
const WORKSPACES = [
  { slug: "northwind", status: "running", turns: 1284, costUsd: 42.18 },
  { slug: "bluebird", status: "running", turns: 316, costUsd: 9.74 },
  { slug: "harbor", status: "suspended", turns: 0, costUsd: 0 },
];

// ── a small PNG (a disc on a flat colour) for the avatars ───────────────
function avatarPng(size, [r, g, b]) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    for (let x = 0; x < size; x++) {
      const inside = (x - c) ** 2 + (y - c * 0.8) ** 2 < (size / 5) ** 2 || ((x - c) ** 2) / 1.2 + (y - size) ** 2 < (size / 2.4) ** 2;
      const k = inside ? 70 : 0;
      raw[row + 1 + x * 3] = Math.min(255, r + k);
      raw[row + 2 + x * 3] = Math.min(255, g + k);
      raw[row + 3 + x * 3] = Math.min(255, b + k);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ── the stub fleet agent (server/fleet-client.ts speaks to it) ──────────
function startFleetStub(socketPath) {
  const month = new Date().toISOString().slice(0, 7);
  const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  const view = {
    domain: "clients.example.test",
    operator: "parity-operator",
    workspaces: WORKSPACES.map((w, i) => ({
      slug: w.slug,
      host: `${w.slug}.clients.example.test`,
      port: 9100 + i,
      status: w.status,
      createdAt: new Date(Date.UTC(2026, 6 + i, 3 + i * 5)).toISOString(),
      // the running ones are up to date: this server's own version
      live: w.status === "running" ? version : "",
      usage: { month, turns: w.turns, costUsd: w.costUsd, billableUsd: w.costUsd ? Math.round(w.costUsd * 130) / 100 : 0 },
    })),
  };
  const server = createHttpServer((req, res) => {
    req.resume();
    res.writeHead(req.method === "GET" && req.url === "/workspaces" ? 200 : 405, { "content-type": "application/json" });
    res.end(JSON.stringify(req.method === "GET" && req.url === "/workspaces" ? view : { error: "the parity fleet stub only lists" }));
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(socketPath, () => resolve(server));
  });
}

/** Start the stub provider and the fleet stub, and write the link file. */
export async function startOrg(home) {
  const { startFakeOidcProvider } = await import(pathToFileURL(join(ROOT, "server", "testing", "fake-oidc-provider.ts")).href);
  const user = signInUser;
  const idp = await startFakeOidcProvider({ user: user(VIEWER) });
  idp.directoryPeople = PEOPLE.map((p) => ({ ...idp.personOf(user(p), p.disabled ? "disabled" : "active"), locale: "en" }));
  idp.directoryTeams = TEAMS;
  idp.profiles = PROFILES;
  for (const p of PEOPLE) idp.profilesBySub.set(p.sub, p.role === "employee" ? [PROFILES[1].id] : PROFILES.map((x) => x.id));
  idp.avatarsEnabled = true;
  for (const p of PEOPLE.slice(0, 4)) idp.avatars.set(p.sub, avatarPng(96, p.rgb));
  for (const t of TEAMS) {
    for (const sub of [...t.managers, ...t.members]) {
      const teams = TEAMS.filter((x) => x.managers.includes(sub) || x.members.includes(sub)).map((x) => ({ id: x.id, name: x.name, manager: x.managers.includes(sub) }));
      idp.setTeams(sub, teams);
    }
  }
  const linkFile = join(home, "link", "pulsabot.json");
  mkdirSync(dirname(linkFile), { recursive: true, mode: 0o750 });
  const fleetSocket = join(home, "fleet.sock");
  const fleet = await startFleetStub(fleetSocket);
  return { idp, linkFile, fleetSocket, fleet, base: "", cookie: "", cookieName: "", cookieValue: "", viewer: { name: VIEWER.name, email: VIEWER.email, principalId: null } };
}

/** The organization server's environment (added to the solo fixture's). */
export function orgServerEnv(org) {
  // The link file Perspicax writes names this server by its public origin.
  writeFileSync(org.linkFile, JSON.stringify({
    version: 1, issuer: org.idp.issuer, client_id: "pulsa-bot", server_id: org.idp.serverId, origin: PUBLIC_URL, link_token: org.idp.linkToken,
  }), { mode: 0o640 });
  return {
    OMB_IDENTITY: "perspicax",
    OMB_PERSPICAX_ISSUER: org.idp.issuer,
    // https so the hosted workspace below is valid too; the sign-in flow is
    // driven over HTTP here and its callback is sent to the real port.
    OMB_PUBLIC_URL: PUBLIC_URL,
    OMB_PERSPICAX_LINK_FILE: org.linkFile,
    OMB_PERSPICAX_DIRECTORY_SECONDS: "5",
    OMB_ORG_NAME: "Parity Org",
    // A hosted workspace signs in through its portal only and refuses the
    // phone's pairing (POST /api/pair): PARITY_ORG_PHONE=1 runs a plain
    // organization server instead.
    ...(process.env.PARITY_ORG_PHONE === "1" ? {} : {
      OMB_ADMIN_URL: "https://admin.example.test",
      OMB_ADMIN_WORKSPACE: "parity",
      OMB_ADMIN_MEMBERSHIP: "portal",
    }),
    OMB_FLEET_SOCKET: org.fleetSocket,
  };
}

/** The enterprise stub of the organization fixture, there for its
 * hosted-workspace bridge that authorizes every session. A present layer
 * alone decides the features, so it grants every one the open-source edition
 * runs with: the captures match the product. */
export function orgEnterpriseStub(dir) {
  mkdirSync(join(dir, "server"), { recursive: true });
  writeFileSync(join(dir, "server", "index.ts"), [
    'export function register() { return { customer: "Parity fixture", features: ["admin", "billing", "budgets", "whitelabel"], expiresAt: null }; }',
    "export function createWorkspaceAccess() { return { handlePublic: async () => false, authorize: async () => null, revalidate: async () => {} }; }",
    "",
  ].join("\n"));
}

const cookiePair = (setCookie) => setCookie.split(";")[0];

/** "Sign in with Pulsatrix" as the viewer, the way a browser does it. */
export async function signInOrg(org) {
  org.idp.user = signInUser(VIEWER);
  org.cookie = await signIn(org);
  [org.cookieName, org.cookieValue] = [org.cookie.slice(0, org.cookie.indexOf("=")), org.cookie.slice(org.cookie.indexOf("=") + 1)];
}

const signInUser = ({ sub, name, preferred_username, email, role }) => ({ sub, name, preferred_username, email, role });

/** The sign-in flow for whoever the stub provider signs in now; the cookie. */
async function signIn(org) {
  const start = await fetch(`${org.base}/auth/oidc/start`, { redirect: "manual" });
  const binding = start.headers.getSetCookie().find((c) => c.includes("_oidc="));
  const to = start.headers.get("location");
  if (!binding || !to) throw new Error(`oidc start: ${start.status} ${await start.text()}`);
  const authorize = await fetch(to, { redirect: "manual" });
  const back = new URL(authorize.headers.get("location") ?? "");
  // The callback names the public origin; it is this server.
  const callback = await fetch(`${org.base}${back.pathname}${back.search}`, { redirect: "manual", headers: { cookie: cookiePair(binding) } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
  if (!session || callback.headers.get("location") !== "/") {
    throw new Error(`oidc callback: ${callback.status} ${callback.headers.get("location")} ${(await callback.text()).slice(0, 300)}`);
  }
  return cookiePair(session);
}

/** PARITY_ORG_PHONE=1: the phone's own sign-in (Sign in with Pulsatrix,
 * `/auth/oidc/start?client=phone&return=sagax`) run over HTTP as the
 * viewer, its pairing invite redeemed through `POST /api/pair` as the app
 * does: a bearer bound to the person, for the UI tests of what follows the
 * person (GET/PUT /api/me/preferences). */
export async function pairOrgPhone(org) {
  const start = await fetch(`${org.base}/auth/oidc/start?client=phone&return=sagax`, { redirect: "manual" });
  const binding = start.headers.getSetCookie().find((c) => c.includes("_oidc="));
  const to = start.headers.get("location");
  if (!binding || !to) throw new Error(`phone oidc start: ${start.status} ${await start.text()}`);
  const authorize = await fetch(to, { redirect: "manual" });
  const back = new URL(authorize.headers.get("location") ?? "");
  const callback = await fetch(`${org.base}${back.pathname}${back.search}`, { redirect: "manual", headers: { cookie: cookiePair(binding) } });
  const invite = new URL(callback.headers.get("location") ?? "about:blank");
  const credential = invite.searchParams.get("token");
  if (invite.protocol !== "sagax:" || !credential) throw new Error(`phone oidc callback: ${callback.status} ${callback.headers.get("location")}`);
  const paired = await fetch(`${org.base}/api/pair`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential, deviceName: "Parity iPhone" }),
  });
  if (!paired.ok) throw new Error(`phone pair: ${paired.status} ${await paired.text()}`);
  const { token } = await paired.json();
  const session = await fetch(`${org.base}/api/auth/session`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json()).catch(() => ({}));
  return { token, environmentId: session?.session?.environmentId ?? session?.environmentId ?? null, scopes: session?.session?.scopes ?? session?.scopes ?? [] };
}

/** After the dataset: Ara is shared and offers Perspicax tools, and the
 * directory has synced (the people the Sharing section lists). */
export async function seedOrg(org, seeded, api) {
  const base = org.base;
  const deadline = Date.now() + 30_000;
  let people = [];
  for (;;) {
    const body = await api(base, "GET", "/api/org/directory").catch(() => ({}));
    people = body?.people ?? [];
    if (people.length >= PEOPLE.length - 1) break;
    if (Date.now() > deadline) throw new Error(`the directory never synced (${people.length} people)`);
    await new Promise((r) => setTimeout(r, 500));
  }
  // Three more people have signed in here once (Settings > People lists
  // who has); the provider then signs the viewer in again.
  for (const person of PEOPLE.slice(1, 4)) {
    org.idp.user = signInUser(person);
    await signIn(org).catch((error) => console.error(`[parity] sign-in ${person.name}: ${error.message}`));
  }
  org.idp.user = signInUser(VIEWER);
  const id = (login) => people.find((p) => p.login === login)?.principalId;
  org.viewer.principalId = id(VIEWER.preferred_username) ?? null;
  // PARITY_PEOPLE=1 (WP15 UI tests): Sam has written to the viewer once,
  // a direct conversation between two people (server/people-dms.ts).
  if (process.env.PARITY_PEOPLE === "1") await seedPeopleDm(org, id("sam.rivera")).catch((error) => console.error(`[parity] people dm: ${error.message}`));
  const ara = seeded.ids.ara.id;
  const grants = [
    [`user:${id("sam.rivera")}`, "manage"],
    [`user:${id("jordan.lee")}`, "use"],
    ["team:01PARITYTEAMSERVICEDESK01", "run"],
  ];
  for (const [target, level] of grants) {
    await api(base, "PUT", `/api/bots/${ara}/grants`, { target, level }).catch((error) => console.error(`[parity] grant ${target}: ${error.message}`));
  }
  await api(base, "PUT", `/api/bots/${ara}/perspicax`, { profiles: [PROFILES[0].id, PROFILES[1].id] })
    .catch((error) => console.error(`[parity] perspicax profiles: ${error.message}`));
}

/** As Sam: open the conversation with the viewer and say hello in it. */
async function seedPeopleDm(org, samId) {
  if (!samId || !org.viewer.principalId) throw new Error("the directory has no Sam or no viewer");
  org.idp.user = signInUser(PEOPLE[1]);
  const cookie = await signIn(org);
  org.idp.user = signInUser(VIEWER);
  const as = async (method, path, body) => {
    const init = { method, headers: { "content-type": "application/json", cookie, origin: org.base } };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(`${org.base}${path}`, init);
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
  const { group } = await as("POST", "/api/people-dms", { principalId: org.viewer.principalId });
  await as("POST", `/api/groups/${group.id}/messages`, { text: "Hello from Sam (parity people fixture)" });
  console.error(`[parity] people dm ${group.id} seeded`);
}

export async function stopOrg(org) {
  if (!org) return;
  await org.idp.close().catch(() => {});
  await new Promise((r) => org.fleet.close(() => r()));
}
