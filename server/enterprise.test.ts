import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkspaceAccess, describeEdition, editionForMembers, editionStatus, enterpriseLayerDirs, entitled, hostedAccessEntitled, hostedWorkspaceConfiguration, hostedWorkspaceConfigured, licenseWarning, OPEN_SOURCE_FEATURES, perspicaxOrganisationLinked, sharedWorkspaceFullAccessConfigured, loadEnterpriseLayer, workspaceMembership } from "./enterprise.ts";
import { SessionRegistry } from "./sessions.ts";

const dirs: string[] = [];

/** A stand-in enterprise layer: the folder shape core looks for, with the given register(). */
function fakeLayer(registerSource: string, file = "index.ts"): string {
  const dir = mkdtempSync(join(tmpdir(), "omb-enterprise-"));
  mkdirSync(join(dir, "server"));
  writeFileSync(join(dir, "server", file), registerSource);
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await loadEnterpriseLayer({ dir: join(tmpdir(), "omb-enterprise-absent"), licenseKey: undefined });
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("enterprise hook point", () => {
  it("requires an explicit operator policy on a complete portal-managed non-desktop workspace", () => {
    const env = { SAGAX_ADMIN_URL: "https://admin.example.test", SAGAX_ADMIN_WORKSPACE: "acme", SAGAX_PUBLIC_URL: "https://acme.example.test",
      SAGAX_ADMIN_MEMBERSHIP: "portal", SAGAX_SHARED_WORKSPACE_FULL_ACCESS: "1" };
    expect(sharedWorkspaceFullAccessConfigured(env)).toBe(true);
    for (const patch of [
      { SAGAX_SHARED_WORKSPACE_FULL_ACCESS: undefined }, { SAGAX_SHARED_WORKSPACE_FULL_ACCESS: "true" },
      { SAGAX_DESKTOP_PARENT: "1" }, { SAGAX_ADMIN_MEMBERSHIP: "local" }, { SAGAX_ADMIN_MEMBERSHIP: undefined },
      { SAGAX_ADMIN_URL: "http://admin.example.test" }, { SAGAX_PUBLIC_URL: "" }, { SAGAX_ADMIN_WORKSPACE: "" },
    ]) expect(sharedWorkspaceFullAccessConfigured({ ...env, ...patch })).toBe(false);
    expect(sharedWorkspaceFullAccessConfigured({ SAGAX_SHARED_WORKSPACE_FULL_ACCESS: "1" })).toBe(false);
  });
  it("does not create a hosted bridge unless opted in, and marks partial configuration as hosted", () => {
    expect(hostedWorkspaceConfigured({})).toBe(false);
    expect(hostedWorkspaceConfigured({ SAGAX_PUBLIC_URL: "https://legacy.example.test" })).toBe(false);
    expect(hostedWorkspaceConfigured({ SAGAX_ADMIN_URL: "" })).toBe(true);
    expect(hostedWorkspaceConfigured({ SAGAX_ADMIN_WORKSPACE: "acme" })).toBe(true);
    expect(hostedWorkspaceConfigured({ SAGAX_ADMIN_MEMBERSHIP: "portal" })).toBe(true);
    const dir = fakeLayer("export const fixture = true;");
    const sessions = new SessionRegistry({ file: join(dir, "sessions.json") });
    expect(createWorkspaceAccess({ sessions, cookieName: "session", closeSessionStreams() {}, env: {} })).toBeNull();
    expect(createWorkspaceAccess({ sessions, cookieName: "session", closeSessionStreams() {}, env: { SAGAX_ADMIN_WORKSPACE: "acme" } })).toBeNull();
  });
  it("reports pairing codes off when a Perspicax organisation is linked, even without a hosted workspace", () => {
    expect(workspaceMembership({})).toEqual({ authority: "local", pairingCodes: true });
    expect(perspicaxOrganisationLinked({ SAGAX_IDENTITY: "perspicax" })).toBe(false);
    expect(workspaceMembership({ SAGAX_IDENTITY: "perspicax" })).toEqual({ authority: "local", pairingCodes: true });
    expect(workspaceMembership({ SAGAX_IDENTITY: " Perspicax ", SAGAX_PERSPICAX_LINK_FILE: "  " })).toEqual({ authority: "local", pairingCodes: true });
    expect(workspaceMembership({ SAGAX_PERSPICAX_LINK_FILE: "/var/lib/sagax/link.json" })).toEqual({ authority: "local", pairingCodes: true });
    const linked = { SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_LINK_FILE: "/var/lib/sagax/link.json" };
    expect(perspicaxOrganisationLinked(linked)).toBe(true);
    expect(workspaceMembership(linked)).toEqual({ authority: "local", pairingCodes: false });
    const portal = { SAGAX_ADMIN_URL: "https://admin.example.test", SAGAX_ADMIN_WORKSPACE: "acme", SAGAX_PUBLIC_URL: "https://acme.example.test", SAGAX_ADMIN_MEMBERSHIP: "portal" };
    expect(workspaceMembership(portal)).toMatchObject({ authority: "portal", pairingCodes: false });
    expect(workspaceMembership({ ...portal, ...linked })).toMatchObject({ authority: "portal", pairingCodes: false });
  });
  it("requires complete valid hosted configuration before opting into portal membership", () => {
    const env = { SAGAX_ADMIN_URL: "https://admin.example.test", SAGAX_ADMIN_WORKSPACE: "acme", SAGAX_PUBLIC_URL: "https://acme.example.test" };
    expect(hostedWorkspaceConfiguration(env)?.portalMembership).toBe(false);
    expect(hostedWorkspaceConfiguration({ ...env, SAGAX_ADMIN_MEMBERSHIP: "portal" })?.portalMembership).toBe(true);
    expect(hostedWorkspaceConfiguration({ ...env, SAGAX_ADMIN_MEMBERSHIP: "local" })?.portalMembership).toBe(false);
    for (const patch of [{ SAGAX_ADMIN_URL: "" }, { SAGAX_PUBLIC_URL: "http://acme.example.test" }, { SAGAX_ADMIN_WORKSPACE: "" }, { SAGAX_ADMIN_MEMBERSHIP: "PORTAL" }]) {
      expect(hostedWorkspaceConfiguration({ ...env, SAGAX_ADMIN_MEMBERSHIP: "portal", ...patch })).toBeNull();
    }
    const dir = fakeLayer("export const fixture = true;");
    const invalid = { SAGAX_ADMIN_MEMBERSHIP: "portal" };
    const sessions = new SessionRegistry({ file: join(dir, "sessions.json"), portalMembership: hostedWorkspaceConfiguration(invalid)?.portalMembership === true });
    const issued = sessions.issuePortal({ email: "member@example.test", grant: "g".repeat(43), scopes: ["client"] });
    expect(sessions.authenticate(issued.token)).toBeNull();
  });
  it("passes the layer's live admin entitlement to its bridge, never the open-source edition's", async () => {
    const dir = fakeLayer(`
      export function register() { return { customer: 'Fixture', features: ['admin'], expiresAt: null }; }
      export function createWorkspaceAccess(options) {
        return { handlePublic: async () => options.entitled(), authorize: async () => null, revalidate: async () => {} };
      }
    `);
    await loadEnterpriseLayer({ dir, licenseKey: "fixture" });
    const sessions = new SessionRegistry({ file: join(dir, "sessions.json") });
    const bridge = createWorkspaceAccess({ sessions, cookieName: "session", closeSessionStreams() {}, env: { SAGAX_ADMIN_WORKSPACE: "acme" } });
    expect(await bridge!.handlePublic(null as never, null as never, null as never)).toBe(true);
    await loadEnterpriseLayer({ dir: join(dir, "absent") });
    // the open-source edition has its own `admin` on, which the bridge must not take for a grant
    expect(entitled("admin")).toBe(true);
    expect(await bridge!.handlePublic(null as never, null as never, null as never)).toBe(false);
  });
  it("never lets the open-source edition stand in for a layer's grant on hosted access", async () => {
    const portal = { SAGAX_ADMIN_URL: "https://admin.example.test", SAGAX_ADMIN_WORKSPACE: "acme", SAGAX_PUBLIC_URL: "https://acme.example.test", SAGAX_ADMIN_MEMBERSHIP: "portal" };
    const dir = fakeLayer(`
      export function register() { throw new Error("no valid key"); }
      export function createWorkspaceAccess(options) {
        return { handlePublic: async () => options.entitled(), authorize: async () => null, revalidate: async () => {} };
      }
    `);
    const sessions = new SessionRegistry({ file: join(dir, "sessions.json") });
    // no layer: every feature on, yet no hosted bridge and no hosted grant
    await loadEnterpriseLayer({ dir: join(dir, "absent"), licenseKey: undefined });
    expect(entitled("admin")).toBe(true);
    expect(hostedAccessEntitled()).toBe(false);
    expect(createWorkspaceAccess({ sessions, cookieName: "session", closeSessionStreams() {}, env: portal })).toBeNull();
    // a layer whose key is refused: its bridge loads but is refused, and the layer turns every feature off
    await loadEnterpriseLayer({ dir, licenseKey: "k" });
    const bridge = createWorkspaceAccess({ sessions, cookieName: "session", closeSessionStreams() {}, env: portal });
    expect(await bridge!.handlePublic(null as never, null as never, null as never)).toBe(false);
    expect(hostedAccessEntitled()).toBe(false);
    for (const feature of OPEN_SOURCE_FEATURES) expect(entitled(feature), feature).toBe(false);
  });
  it("starts as the open-source edition, every feature on, before the server looks for a layer", async () => {
    vi.resetModules();
    const fresh = await import("./enterprise.ts");
    expect(fresh.editionStatus()).toEqual({ edition: "oss", features: ["admin", "billing", "budgets", "whitelabel"] });
    expect(fresh.entitled("budgets")).toBe(true);
    expect(fresh.hostedAccessEntitled()).toBe(false);
  });
  it("is the open-source edition with every feature on when the folder is absent, key or not", async () => {
    const absent = join(tmpdir(), "omb-enterprise-absent");
    expect(await loadEnterpriseLayer({ dir: absent, licenseKey: undefined })).toEqual({ edition: "oss", features: ["admin", "billing", "budgets", "whitelabel"] });
    for (const feature of OPEN_SOURCE_FEATURES) expect(entitled(feature), feature).toBe(true);
    // unknown ids are still not granted, and nothing counts down
    expect(entitled("sso")).toBe(false);
    expect(licenseWarning(editionStatus())).toBeNull();
    expect(describeEdition(editionStatus())).toBe("Sagax open-source edition");
    // a key set anyway unlocks nothing more and says so (CI greps "no enterprise layer exists")
    const status = await loadEnterpriseLayer({ dir: absent, licenseKey: "omb1.x.y" });
    expect(status.edition).toBe("oss");
    expect(status.features).toEqual([...OPEN_SOURCE_FEATURES]);
    expect(status.notice).toContain("SAGAX_LICENSE_KEY is set but no enterprise layer exists");
    expect(status.notice).toContain("the open-source edition needs no key");
    expect(entitled("whitelabel")).toBe(true);
    expect(describeEdition(status)).toContain("open-source edition (SAGAX_LICENSE_KEY is set");
  });

  it("registers the layer's entitlements from the key, and only those", async () => {
    const dir = fakeLayer(`export async function register({ licenseKey }) {
      if (licenseKey !== "good") throw new Error("bad key");
      return { customer: "Acme", features: ["sso", "whitelabel", "sso"], expiresAt: "2027-01-01" };
    }`);
    const status = await loadEnterpriseLayer({ dir, licenseKey: "good" });
    expect(status).toEqual({ edition: "enterprise", customer: "Acme", features: ["sso", "whitelabel"], expiresAt: "2027-01-01" });
    expect(editionStatus(new Date("2026-09-23T12:00:00Z").getTime())).toEqual({ ...status, expiresInDays: 100 });
    expect(entitled("whitelabel")).toBe(true);
    // a present layer alone decides, even about what the open-source edition has on
    expect(entitled("budgets")).toBe(false);
    expect(entitled("admin")).toBe(false);
    expect(hostedAccessEntitled()).toBe(false);
    expect(describeEdition(status)).toBe("Sagax enterprise edition for Acme until 2027-01-01: sso, whitelabel");
  });

  it("loads a compiled layer (server/index.js) the way an image ships it", async () => {
    const dir = fakeLayer(`export function register() { return { customer: "Built", features: ["admin"], expiresAt: null }; }`, "index.js");
    const status = await loadEnterpriseLayer({ dir, licenseKey: "k" });
    expect(status).toEqual({ edition: "enterprise", customer: "Built", features: ["admin"], expiresAt: null });
    expect(hostedAccessEntitled()).toBe(true);
    expect(describeEdition(status)).toBe("Sagax enterprise edition for Built: admin");
  });

  it("warns for 30 days, keeps working for a 7-day grace, then stops granting features without a restart", async () => {
    const dir = fakeLayer(`export function register({ graceDays }) {
      if (graceDays !== 7) throw new Error("core must ask for its grace period");
      return { customer: "Acme", features: ["sso"], expiresAt: "2027-01-01" };
    }`);
    await loadEnterpriseLayer({ dir, licenseKey: "k" });
    const at = (iso: string) => new Date(iso).getTime();
    // far from expiry: the day count is there, the warning is not
    const quiet = editionStatus(at("2026-11-01T00:00:00Z"));
    expect(quiet).toMatchObject({ edition: "enterprise", expiresInDays: 61 });
    expect(quiet.notice).toBeUndefined();
    expect(licenseWarning(quiet)).toBeNull();
    // inside the warning window
    const soon = editionStatus(at("2026-12-02T00:00:00Z"));
    expect(soon).toMatchObject({ edition: "enterprise", expiresInDays: 30 });
    expect(licenseWarning(soon)).toBe("SAGAX_LICENSE_KEY expires on 2027-01-01 (in 30 days); renew it before then to keep enterprise features");
    expect(licenseWarning(editionStatus(at("2026-12-31T12:00:00Z")))).toContain("(in 1 day)");
    expect(entitled("sso", at("2026-12-31T23:59:59Z"))).toBe(true);
    // expired, in grace: still enterprise, still entitled, and it says so
    const grace = editionStatus(at("2027-01-03T00:00:00Z"));
    expect(grace).toMatchObject({ edition: "enterprise", features: ["sso"], expiresInDays: -2, graceEndsAt: "2027-01-08" });
    expect(grace.notice).toBe("SAGAX_LICENSE_KEY expired on 2027-01-01; enterprise features keep working until 2027-01-08 while it is renewed");
    expect(licenseWarning(grace)).toContain("keep working until 2027-01-08");
    expect(entitled("sso", at("2027-01-01T00:00:00Z"))).toBe(true);
    expect(entitled("sso", at("2027-01-07T23:59:59Z"))).toBe(true);
    // grace over
    const after = at("2027-01-08T00:00:00Z");
    expect(entitled("sso", after)).toBe(false);
    const lapsed = editionStatus(after);
    expect(lapsed.edition).toBe("oss");
    // a lapsed layer key turns every feature off, never back to the open-source set
    expect(lapsed.features).toEqual([]);
    expect(entitled("admin", after)).toBe(false);
    expect(lapsed.expiresInDays).toBeUndefined();
    expect(lapsed.notice).toMatch(/expired on 2027-01-01; renew it/);
    expect(licenseWarning(lapsed)).toBeNull();
    // members see what is entitled, not the countdown, grace date or notice
    expect(editionForMembers(grace)).toEqual({ edition: "enterprise", customer: "Acme", features: ["sso"], expiresAt: "2027-01-01" });
    expect(editionForMembers(lapsed)).toEqual({ edition: "oss", features: [] });
  });

  it("never warns about a perpetual key or the open-source edition", async () => {
    const dir = fakeLayer(`export function register() { return { customer: "Acme", features: ["sso"], expiresAt: null }; }`);
    await loadEnterpriseLayer({ dir, licenseKey: "k" });
    const perpetual = editionStatus(new Date("2099-01-01").getTime());
    expect(perpetual.expiresInDays).toBeUndefined();
    expect(licenseWarning(perpetual)).toBeNull();
    expect(licenseWarning({ edition: "oss", features: [] })).toBeNull();
  });

  it("finds the layer beside the server root, then inside it (the Docker and desktop layout), unless SAGAX_ENTERPRISE_DIR says where", async () => {
    const root = mkdtempSync(join(tmpdir(), "omb-layout-"));
    dirs.push(root);
    const serverRoot = join(root, "dist-server");
    const layer = (dir: string, customer: string) => {
      mkdirSync(join(dir, "server"), { recursive: true });
      writeFileSync(join(dir, "server", "index.js"), `export function register() { return { customer: "${customer}", features: ["admin"], expiresAt: null }; }`);
    };
    expect(enterpriseLayerDirs({}, serverRoot)).toEqual([join(root, "enterprise"), join(serverRoot, "enterprise")]);
    expect(enterpriseLayerDirs({ SAGAX_ENTERPRISE_DIR: "/opt/layer" }, serverRoot)).toEqual(["/opt/layer"]);
    // nothing anywhere: the notice names every place it looked
    const none = await loadEnterpriseLayer({ env: {}, serverRoot, licenseKey: "k" });
    expect(none.notice).toBe(`SAGAX_LICENSE_KEY is set but no enterprise layer exists at ${join(root, "enterprise")} or ${join(serverRoot, "enterprise")}; the open-source edition needs no key`);
    // the image: only dist-server/enterprise exists
    layer(join(serverRoot, "enterprise"), "Inside");
    expect(await loadEnterpriseLayer({ env: {}, serverRoot, licenseKey: "k" })).toMatchObject({ edition: "enterprise", customer: "Inside" });
    // a checkout or the npm package: the sibling wins
    layer(join(root, "enterprise"), "Sibling");
    expect(await loadEnterpriseLayer({ env: {}, serverRoot, licenseKey: "k" })).toMatchObject({ customer: "Sibling" });
    // an explicit directory is the only place looked at
    const explicit = join(root, "elsewhere");
    expect((await loadEnterpriseLayer({ env: { SAGAX_ENTERPRISE_DIR: explicit }, serverRoot, licenseKey: "k" })).notice)
      .toBe(`SAGAX_LICENSE_KEY is set but no enterprise layer exists at ${explicit}; the open-source edition needs no key`);
    layer(explicit, "Explicit");
    expect(await loadEnterpriseLayer({ env: { SAGAX_ENTERPRISE_DIR: explicit }, serverRoot, licenseKey: "k" })).toMatchObject({ customer: "Explicit" });
  });

  it("turns every feature off with the layer's own message when the key is refused: a present layer decides", async () => {
    const dir = fakeLayer(`export function register() { throw new Error("license expired on 2025-01-01"); }`);
    const status = await loadEnterpriseLayer({ dir, licenseKey: "stale" });
    expect(status.edition).toBe("oss");
    expect(status.features).toEqual([]);
    expect(status.notice).toBe("enterprise layer disabled: license expired on 2025-01-01");
    expect(entitled("sso")).toBe(false);
    for (const feature of OPEN_SOURCE_FEATURES) expect(entitled(feature), feature).toBe(false);
  });

  it("tells the operator when the layer is present but no key is configured", async () => {
    const dir = fakeLayer(`export function register() { return { customer: "x", features: [], expiresAt: null }; }`);
    const status = await loadEnterpriseLayer({ dir, licenseKey: undefined });
    expect(status).toEqual({ edition: "oss", features: [], notice: "enterprise layer present but SAGAX_LICENSE_KEY is not set" });
    expect(entitled("admin")).toBe(false);
  });

  it("refuses a layer that does not honour the contract", async () => {
    const noRegister = fakeLayer(`export const version = 1;`);
    expect((await loadEnterpriseLayer({ dir: noRegister, licenseKey: "k" })).notice).toContain("does not export register()");
    const badShape = fakeLayer(`export function register() { return { customer: "", features: "all" }; }`);
    const status = await loadEnterpriseLayer({ dir: badShape, licenseKey: "k" });
    expect(status.edition).toBe("oss");
    expect(status.notice).toContain("enterprise layer disabled:");
    expect(entitled("all")).toBe(false);
  });
});
