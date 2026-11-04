import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it, vi } from "vitest";
import type { BotRecord, Message } from "../store.ts";
import type { AppConfig } from "../config.ts";
import { createBotAvatarGenerateRoutes, type BotAvatarGenerateRouteDeps } from "./bot-avatar-generate.ts";
import { createBotObservabilityRoutes, type BotObservabilityRouteDeps } from "./bot-observability.ts";
import { createBotSecretCardRoutes, type BotSecretCardRouteDeps } from "./bot-secret-cards.ts";
import { createFleetRoutes, type FleetRouteDeps } from "./fleet.ts";
import { PASS, dispatchRoutes, type RouteContext } from "./table.ts";

const mocks = vi.hoisted(() => ({ generate: vi.fn(), save: vi.fn(), remove: vi.fn(), activity: vi.fn(() => []) }));
vi.mock("../media/avatar-image.ts", async (original) => ({ ...await original<typeof import("../media/avatar-image.ts")>(), generateAvatarImage: mocks.generate }));
vi.mock("../attachments/attachments.ts", () => ({ saveImage: mocks.save, deleteAttachment: mocks.remove }));
vi.mock("../activity/activity.ts", () => ({ readBotActivity: mocks.activity }));

function context(path: string, method = "GET", body: unknown = {}, headers: Record<string, string> = {}) {
  const json = vi.fn();
  const url = new URL(`http://fixture${path}`);
  const ctx = {
    req: { headers }, res: { setHeader: vi.fn() }, url, path: url.pathname, method,
    auth: { kind: "loopback", scopes: ["client", "admin"] }, json, readBody: vi.fn(async () => body),
  } as unknown as RouteContext;
  return { ctx, json };
}
const bot = { id: "osprey", name: "Osprey", threadId: "thread-1", avatarCrop: "circle" } as BotRecord;

function avatarDeps(): BotAvatarGenerateRouteDeps {
  return { store: { bot: vi.fn(() => bot), patchBot: vi.fn(() => bot) }, ownerOrAdminOf: () => true,
    requesterPrincipal: () => "pr_osprey", orgAvatarImageConfig: () => ({}), orgXaiRefusal: () => ({ error: "unavailable" }),
    wireBot: vi.fn(), broadcast: vi.fn() };
}
function observabilityDeps(): BotObservabilityRouteDeps {
  return { store: { bot: vi.fn(() => bot), tasks: vi.fn(() => []) }, DATA_DIR: "/fixture", EVENTS_DIR: "/fixture/events",
    ownerOrAdminOf: () => false, computerOwner: () => false, outboundCounts: { today: vi.fn(() => 2) } };
}
function secretDeps(): BotSecretCardRouteDeps {
  return { getConfig: () => ({} as AppConfig), provideSecretFromPhone: vi.fn(), secretMessage: () => null,
    phoneSecretSubmissions: { has: () => false }, phoneSecretSubmissionKey: (...parts) => parts.join(":"),
    resumeSecretCard: vi.fn(() => true), currentSecretState: () => ({ provided: true, resumed: true }) };
}
function fleetDeps(): FleetRouteDeps {
  return { entitled: () => true, fleetSocketPath: () => "/fixture/fleet.sock", fleetAvailable: () => true,
    fleetRequest: vi.fn(async () => ({ status: 201, body: { ok: true } })) };
}

describe("remaining route modules", () => {
  it("passes unrelated requests to the next route", async () => {
    for (const route of [createBotAvatarGenerateRoutes(avatarDeps()), createBotObservabilityRoutes(observabilityDeps()), createBotSecretCardRoutes(secretDeps()), createFleetRoutes(fleetDeps())]) {
      expect(await route(context("/api/unrelated").ctx)).toBe(PASS);
    }
  });

  it("refuses another person's avatar change before generation", async () => {
    mocks.generate.mockClear();
    const deps = avatarDeps(); deps.ownerOrAdminOf = () => false;
    const { ctx, json } = context("/api/bots/osprey/avatar/generate", "POST");
    await createBotAvatarGenerateRoutes(deps)(ctx);
    expect(json).toHaveBeenCalledWith(ctx.res, 403, expect.objectContaining({ code: "bot_picture_owner_only" }));
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("keeps a newer picture when generation finishes after an edit", async () => {
    const current = { ...bot };
    const deps = avatarDeps(); deps.store.bot = () => current;
    mocks.generate.mockImplementationOnce(async () => { current.avatarUrl = "/api/attachments/new.png"; return { bytes: Buffer.alloc(1), mime: "image/png" }; });
    const { ctx, json } = context("/api/bots/osprey/avatar/generate", "POST", { prompt: "a drawn bird" });
    await createBotAvatarGenerateRoutes(deps)(ctx);
    expect(json).toHaveBeenCalledWith(ctx.res, 409, { error: "avatar changed while generation was in progress" });
    expect(deps.store.patchBot).not.toHaveBeenCalled();
  });

  it("keeps the outbound owner guard and rejects invalid activity limits", async () => {
    const deps = observabilityDeps();
    const route = createBotObservabilityRoutes(deps);
    const denied = context("/api/bots/osprey/outbound"); await route(denied.ctx);
    expect(denied.json).toHaveBeenCalledWith(denied.ctx.res, 403, expect.objectContaining({ code: "bot_outbound_owner_only" }));
    expect(deps.outboundCounts.today).not.toHaveBeenCalled();
    const invalid = context("/api/bots/osprey/activity?limit=0"); await route(invalid.ctx);
    expect(invalid.json).toHaveBeenCalledWith(invalid.ctx.res, 400, { error: "limit must be a positive whole number" });
  });

  it("preserves each request's scope across asynchronous route dispatch", async () => {
    const scope = new AsyncLocalStorage<string>();
    const seen: string[] = [];
    const deps = fleetDeps();
    deps.fleetRequest = async () => { await Promise.resolve(); seen.push(scope.getStore()!); return { status: 200, body: {} }; };
    const route = createFleetRoutes(deps);
    await Promise.all(["pr_osprey", "pr_wren"].map((person) => scope.run(person, () => dispatchRoutes([route], context("/api/fleet").ctx))));
    expect(seen.sort()).toEqual(["pr_osprey", "pr_wren"]);
  });

  it("forwards supported fleet operations with their original body limits", async () => {
    const deps = fleetDeps(); const { ctx, json } = context("/api/fleet/workspaces", "POST", { slug: "osprey" });
    await createFleetRoutes(deps)(ctx);
    expect(ctx.readBody).toHaveBeenCalledWith(ctx.req, 256 * 1024);
    expect(deps.fleetRequest).toHaveBeenCalledWith("/fixture/fleet.sock", "POST", "/workspaces", { slug: "osprey" });
    expect(json).toHaveBeenCalledWith(ctx.res, 201, { ok: true });
  });

  it("requires the paired phone and its device identity", async () => {
    const deps = secretDeps(); const route = createBotSecretCardRoutes(deps);
    const direct = context("/api/bots/osprey/secret-cards/card-1/provide", "POST"); await route(direct.ctx);
    expect(direct.json).toHaveBeenCalledWith(direct.ctx.res, 403, expect.anything());
    const noDevice = context("/api/bots/osprey/secret-cards/card-1/provide", "POST", {}, { "x-openmausbot-companion": "1" }); await route(noDevice.ctx);
    expect(noDevice.json).toHaveBeenCalledWith(noDevice.ctx.res, 401, expect.anything());
    expect(deps.provideSecretFromPhone).not.toHaveBeenCalled();
  });

  it("keeps a missing or hidden credential card unavailable", async () => {
    const deps = secretDeps();
    const { ctx, json } = context("/api/bots/osprey/secret-cards/card-1/provided", "POST", { threadId: "thread-1" });
    await createBotSecretCardRoutes(deps)(ctx);
    expect(json).toHaveBeenCalledWith(ctx.res, 404, { error: "no such credential request" });
    expect(deps.resumeSecretCard).not.toHaveBeenCalled();
  });

  it("reads current config after the body await before resuming a credential", async () => {
    const deps = secretDeps(); let config = {} as AppConfig;
    deps.getConfig = () => config;
    deps.secretMessage = () => ({ id: "card-1", secret: { target: "xaiApiKey", requestKey: "request-1" } } as Message);
    const { ctx, json } = context("/api/bots/osprey/secret-cards/card-1/provided", "POST");
    ctx.readBody = async () => { config = { xai: { key: "fixture-only" } } as AppConfig; return { threadId: "thread-1" }; };
    await createBotSecretCardRoutes(deps)(ctx);
    expect(deps.resumeSecretCard).toHaveBeenCalledWith("osprey", "thread-1", "card-1", "provided");
    expect(json).toHaveBeenCalledWith(ctx.res, 200, { provided: true, resumed: true });
  });
});
