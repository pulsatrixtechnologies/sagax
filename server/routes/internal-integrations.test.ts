import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  createInternalIntegrationsRoutes,
  raiseProductKeyCard,
  type InternalIntegrationsBot,
  type InternalIntegrationsDeps,
} from "./internal-integrations.ts";
import type { InternalRouteContext } from "./internal-route.ts";
import { PASS } from "./table.ts";

const bot: InternalIntegrationsBot = {
  id: "bot-1",
  name: "Ada",
  color: "blue",
  threadId: "t-1",
};

function deps(over: Partial<InternalIntegrationsDeps> = {}): InternalIntegrationsDeps {
  return {
    bot: (id) => (id === bot.id ? bot : null),
    isPerspicax: () => false,
    ownsThread: (botId, threadId) => (botId === bot.id && threadId === "t-1" ? { group: false } : null),
    vaultPrincipalForThread: () => "person-1",
    principalIsOrgAdmin: () => false,
    principalCan: () => true,
    permissionRefusal: (key) => ({ error: "forbidden", permission: key, message: `need ${key}` }),
    addPersonalMcpServer: async () => undefined,
    sourceApprovalMode: () => "auto",
    setPersonalMcpEnabled: () => undefined,
    closePersonalStdio: () => undefined,
    tryBeginMcpConfigUpdate: () => true,
    endMcpConfigUpdate: () => undefined,
    mcpServers: () => ({}),
    addDisabledMcpServer: () => ({
      ok: true as const,
      name: "tools",
      server: { command: "npx", args: [] as string[], env: {} as Record<string, string>, enabled: false },
      next: { tools: { command: "npx", args: [] as string[], env: {} as Record<string, string>, enabled: false } },
    }),
    sharedMcpPersonalRefusal: () => null,
    mcpPolicyRefusal: () => undefined,
    persistMcpServers: () => undefined,
    turnSpeaker: () => ({ origin: "person" as const, principalId: "person-1" }),
    turnIsRoutine: () => false,
    turnIsInternal: () => false,
    turnIsAutomation: () => false,
    turnIsUnattended: () => false,
    localPrincipalId: () => "local",
    personGithub: () => undefined,
    githubProbeStatus: async () => ({ state: "disconnected" as const }),
    githubDeviceFlowAvailable: () => true,
    githubStartDeviceFlow: async () => ({
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      expiresAt: Date.now() + 900_000,
    }),
    githubTokenKind: () => "classic",
    credentialConfigured: () => false,
    appendMessage: () => ({ id: "msg-1" }),
    activePath: () => [],
    patchMessage: () => undefined,
    botForThread: () => bot,
    orgXaiMediaGiven: () => false,
    turnMediaPrincipal: () => "person-1",
    botOwner: () => "person-1",
    speakVoiceNote: async () => ({ bytes: new Uint8Array([1, 2]), mime: "audio/mpeg" }),
    requireActive: () => undefined,
    liveTurnId: () => "turn-1",
    saveAudio: () => ({ path: "/tmp/a.mp3", mime: "audio/mpeg" }),
    pushTurnAttachment: () => undefined,
    isConfidentialThread: () => false,
    confidentialPerspicaxRefusal: () => null,
    misuseToolFrameText: () => null,
    misuseTextRefusal: () => null,
    safetyPrincipal: () => ({ triage: false }),
    misuseActor: () => ({ triage: false }),
    safetyReviewer: () => undefined,
    safetyToolHold: async () => null,
    perspicaxMounted: () => true,
    perspicaxRelay: async () => ({ status: 200, body: { jsonrpc: "2.0", id: 1, result: {} } }),
    ...over,
  };
}

function call(
  route: ReturnType<typeof createInternalIntegrationsRoutes>,
  opts: {
    path: string;
    method?: string;
    body?: Record<string, unknown>;
    query?: string;
    capability?: InternalRouteContext["capability"];
  },
) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const ended: Array<{ status: number; body: string; headers: Record<string, string> }> = [];
  let statusCode = 200;
  let responseHeaders: Record<string, string> = {};
  const res = {
    headersSent: false,
    writableEnded: false,
    writeHead(status: number, headers?: Record<string, string>) {
      statusCode = status;
      responseHeaders = headers ?? {};
    },
    end(payload?: string) {
      (res as { writableEnded: boolean }).writableEnded = true;
      ended.push({ status: statusCode, body: payload ?? "", headers: responseHeaders });
    },
  } as unknown as ServerResponse;
  const url = new URL(`http://x${opts.path}${opts.query ? `?${opts.query}` : ""}`);
  const ctx: InternalRouteContext = {
    res,
    path: opts.path,
    method: opts.method ?? "POST",
    url,
    json: ((_r, status, body) => {
      sent.push({ status, body });
    }) as InternalRouteContext["json"],
    capability: opts.capability ?? { botId: bot.id, threadId: "t-1", generation: "g-1" },
    readBody: async () => opts.body ?? {},
  };
  return {
    ctx,
    sent,
    ended,
    run: () => route(ctx),
  };
}

describe("createInternalIntegrationsRoutes", () => {
  it("passes foreign paths and methods", async () => {
    const route = createInternalIntegrationsRoutes(deps());
    expect(await route(call(route, { path: "/api/internal/ask-bot" }).ctx)).toBe(PASS);
    expect(await route(call(route, { path: "/api/internal/mcp-servers", method: "GET" }).ctx)).toBe(PASS);
    expect(await route(call(route, { path: "/api/internal/computer-control" }).ctx)).toBe(PASS);
    expect(await route(call(route, { path: "/api/mcp/servers" }).ctx)).toBe(PASS);
  });

  it("POST /mcp-servers (perspicax) refuses a foreign source conversation (403)", async () => {
    const route = createInternalIntegrationsRoutes(deps({
      isPerspicax: () => true,
      ownsThread: () => null,
    }));
    const { sent, run } = call(route, { path: "/api/internal/mcp-servers", body: { name: "x", url: "https://x.test/mcp" } });
    await run();
    expect(sent).toEqual([{ status: 403, body: { error: "source conversation does not belong to sender" } }]);
  });

  it("POST /mcp-servers (perspicax) refuses missing ownIntegrations (403)", async () => {
    const route = createInternalIntegrationsRoutes(deps({
      isPerspicax: () => true,
      principalCan: () => false,
      permissionRefusal: (key) => ({ error: "forbidden", permission: key, message: "no" }),
    }));
    const { sent, run } = call(route, { path: "/api/internal/mcp-servers", body: { name: "x", url: "https://x.test/mcp" } });
    await run();
    expect(sent[0]?.status).toBe(403);
    expect(sent[0]?.body).toMatchObject({ error: "forbidden", permission: "apps.ownIntegrations" });
  });

  it("POST /mcp-servers (perspicax) adds a personal remote server (201)", async () => {
    const addPersonalMcpServer = vi.fn(async () => undefined);
    const route = createInternalIntegrationsRoutes(deps({
      isPerspicax: () => true,
      addPersonalMcpServer,
      sourceApprovalMode: () => "auto",
    }));
    const { sent, run } = call(route, {
      path: "/api/internal/mcp-servers",
      body: { name: "tools", url: "https://example.com/mcp" },
    });
    await run();
    expect(addPersonalMcpServer).toHaveBeenCalledOnce();
    expect(sent[0]?.status).toBe(201);
    expect(sent[0]?.body).toMatchObject({ name: "tools", personal: true, enabled: true });
  });

  it("POST /mcp-servers (shared) returns 409 when busy", async () => {
    const route = createInternalIntegrationsRoutes(deps({
      tryBeginMcpConfigUpdate: () => false,
    }));
    const { sent, run } = call(route, { path: "/api/internal/mcp-servers", body: { name: "x", command: "echo" } });
    await run();
    expect(sent).toEqual([{ status: 409, body: { error: "MCP servers are already being updated." } }]);
  });

  it("POST /mcp-servers (shared) adds a disabled server (201)", async () => {
    const persistMcpServers = vi.fn();
    const endMcpConfigUpdate = vi.fn();
    const route = createInternalIntegrationsRoutes(deps({
      persistMcpServers,
      endMcpConfigUpdate,
      sourceApprovalMode: () => "ask",
    }));
    const { sent, run } = call(route, { path: "/api/internal/mcp-servers", body: { name: "tools", command: "npx" } });
    await run();
    expect(persistMcpServers).toHaveBeenCalledOnce();
    expect(endMcpConfigUpdate).toHaveBeenCalledOnce();
    expect(sent[0]?.status).toBe(201);
    expect(sent[0]?.body).toMatchObject({ name: "tools", enabled: false, transport: "command" });
  });

  it("POST /github-connect refuses a foreign source conversation (403)", async () => {
    const route = createInternalIntegrationsRoutes(deps({ ownsThread: () => null }));
    const { sent, run } = call(route, { path: "/api/internal/github-connect" });
    await run();
    expect(sent).toEqual([{ status: 403, body: { error: "source conversation does not belong to sender" } }]);
  });

  it("POST /github-connect returns not_person when the turn is unattended", async () => {
    const route = createInternalIntegrationsRoutes(deps({ turnIsUnattended: () => true }));
    const { sent, run } = call(route, { path: "/api/internal/github-connect" });
    await run();
    expect(sent).toEqual([{ status: 200, body: { state: "not_person" } }]);
  });

  it("POST /github-connect starts a device flow for the operator at this computer (#2806)", async () => {
    const githubStartDeviceFlow = vi.fn(async () => ({
      userCode: "OPER-0001",
      verificationUri: "https://github.com/login/device",
      expiresAt: 1_700_000_000_000,
    }));
    const route = createInternalIntegrationsRoutes(deps({ turnSpeaker: () => ({ origin: "operator" as const }), githubStartDeviceFlow }));
    const { sent, run } = call(route, { path: "/api/internal/github-connect" });
    await run();
    expect(githubStartDeviceFlow).toHaveBeenCalledWith("local");
    expect(sent[0]?.body).toMatchObject({ state: "pending", userCode: "OPER-0001" });
  });

  it("POST /github-connect refuses the operator on a Perspicax server without a principal (#2806)", async () => {
    const route = createInternalIntegrationsRoutes(deps({ turnSpeaker: () => ({ origin: "operator" as const }), isPerspicax: () => true }));
    const { sent, run } = call(route, { path: "/api/internal/github-connect" });
    await run();
    expect(sent[0]?.status).toBe(403);
  });

  it("POST /github-connect starts a device flow (happy path)", async () => {
    const githubStartDeviceFlow = vi.fn(async () => ({
      userCode: "WXYZ-9999",
      verificationUri: "https://github.com/login/device",
      expiresAt: 1_700_000_000_000,
    }));
    const route = createInternalIntegrationsRoutes(deps({ githubStartDeviceFlow }));
    const { sent, run } = call(route, { path: "/api/internal/github-connect" });
    await run();
    expect(githubStartDeviceFlow).toHaveBeenCalledWith("person-1");
    expect(sent).toEqual([{
      status: 200,
      body: {
        state: "pending",
        userCode: "WXYZ-9999",
        verificationUri: "https://github.com/login/device",
        expiresAt: 1_700_000_000_000,
      },
    }]);
  });

  it("POST /github-connect posts the sign-in card in a group chat too, for the person who asked (#2109)", async () => {
    const githubPostCard = vi.fn(() => "msg-card");
    const route = createInternalIntegrationsRoutes(deps({
      ownsThread: () => ({ group: true }),
      principalCan: () => false,
      isPerspicax: () => true,
      githubPostCard,
    }));
    const { sent, run } = call(route, { path: "/api/internal/github-connect" });
    await run();
    expect(githubPostCard).toHaveBeenCalledWith("person-1", "t-1", expect.objectContaining({ userCode: "ABCD-1234" }), { botId: "bot-1", name: "Ada", color: "blue" });
    expect(sent[0]).toMatchObject({ status: 200, body: { state: "pending", userCode: "ABCD-1234", card: true } });
  });

  it("POST /github-connect reuses the waiting code and its card", async () => {
    const githubStartDeviceFlow = vi.fn();
    const githubPostCard = vi.fn(() => "msg-card");
    const route = createInternalIntegrationsRoutes(deps({
      githubProbeStatus: async () => ({ state: "pending", userCode: "QRST-1111", verificationUri: "https://github.com/login/device", expiresAt: Date.now() + 600_000 }),
      githubStartDeviceFlow,
      githubPostCard,
    }));
    const { sent, run } = call(route, { path: "/api/internal/github-connect" });
    await run();
    expect(githubStartDeviceFlow).not.toHaveBeenCalled();
    expect(githubPostCard).toHaveBeenCalledWith("person-1", "t-1", expect.objectContaining({ userCode: "QRST-1111" }), undefined);
    expect(sent[0]?.body).toMatchObject({ state: "pending", userCode: "QRST-1111", card: true });
  });

  it("POST /request-credential refuses a foreign source conversation (403)", async () => {
    const route = createInternalIntegrationsRoutes(deps({ ownsThread: () => null }));
    const { sent, run } = call(route, {
      path: "/api/internal/request-credential",
      body: { credentialId: "xaiApiKey" },
    });
    await run();
    expect(sent).toEqual([{ status: 403, body: { error: "source conversation does not belong to sender" } }]);
  });

  it("POST /request-credential rejects an unsupported id (400)", async () => {
    const route = createInternalIntegrationsRoutes(deps());
    const { sent, run } = call(route, {
      path: "/api/internal/request-credential",
      body: { credentialId: "not-a-real-key" },
    });
    await run();
    // Custom secrets need a label; an unknown id without one explains both shapes.
    expect(sent).toEqual([{
      status: 400,
      body: { error: "request_credential needs credential_id for a key Sagax keeps, or label for any other secret." },
    }]);
  });

  it("POST /request-credential appends a secret card (201)", async () => {
    const appendMessage = vi.fn(() => ({ id: "sec-1" }));
    const route = createInternalIntegrationsRoutes(deps({ appendMessage }));
    const { sent, run } = call(route, {
      path: "/api/internal/request-credential",
      body: { credentialId: "xaiApiKey", reason: "need grok" },
    });
    await run();
    expect(appendMessage).toHaveBeenCalledOnce();
    expect(sent).toEqual([{ status: 201, body: { messageId: "sec-1", label: "xAI API key" } }]);
  });

  // #4185: the key card of one of the person's Perspicax products
  const product = { id: "psa", name: "Acme PSA", state: "key_missing" as const, roles: [], actions: ["set_own_key" as const] };
  it("POST /request-credential raises a product key card naming the product only, superseding an older one", async () => {
    const appendMessage = vi.fn((_threadId: string, _message: Record<string, unknown>) => ({ id: "sec-2" }));
    const patchMessage = vi.fn();
    const ownerProduct = vi.fn(async () => ({ ok: true as const, product, for: "pr_ann" }));
    const route = createInternalIntegrationsRoutes(deps({
      appendMessage, patchMessage, ownerProduct,
      activePath: () => [
        { id: "old", kind: "productKey", secret: { target: "perspicaxProduct", product: { id: "psa" } } as never },
        { id: "other", kind: "productKey", secret: { target: "perspicaxProduct", product: { id: "docs" } } as never },
      ],
    }));
    const { sent, run } = call(route, { path: "/api/internal/request-credential", body: { productId: "psa" } });
    await run();
    expect(ownerProduct).toHaveBeenCalledWith("bot-1", "psa");
    expect(sent).toEqual([{ status: 201, body: { messageId: "sec-2", label: "Acme PSA" } }]);
    const card = appendMessage.mock.calls[0]![1] as { kind: string; text: string; secret: Record<string, unknown> };
    expect(card.secret).toMatchObject({ target: "perspicaxProduct", label: "Acme PSA", product: { id: "psa", name: "Acme PSA", reason: "key_missing", for: "pr_ann" } });
    // its own kind: a released app draws its text (never a one-field key form), which says what to do
    expect(card.kind).toBe("productKey");
    expect(card.text).toMatch(/Acme PSA/);
    // true on the phone (no product key card there yet) and on an older desktop:
    // the card is entered in Sagax on a computer, never "update Sagax"
    expect(card.text).toMatch(/in Sagax on your computer/);
    expect(card.text).toMatch(/never paste it in the chat/);
    expect(card.text).not.toMatch(/update Sagax/i);
    expect(card.secret).not.toHaveProperty("form");
    expect(patchMessage).toHaveBeenCalledOnce();
    expect(patchMessage).toHaveBeenCalledWith("t-1", "old", { secret: expect.objectContaining({ superseded: true }) });
  });

  it("raiseProductKeyCard is the one function the relay calls too: a card for the product, or connected, or the refusal", async () => {
    const appendMessage = vi.fn((_threadId: string, _message: Record<string, unknown>) => ({ id: "sec-9" }));
    const base = { appendMessage, activePath: () => [], patchMessage: vi.fn() };
    const shown = await raiseProductKeyCard({ ...base, ownerProduct: async () => ({ ok: true as const, product: { ...product, state: "key_refused" as const }, for: "pr_ann" }) }, { bot: { id: "bot-1", name: "Ada" }, threadId: "t-1", group: false, productId: "psa" });
    expect(shown).toEqual({ kind: "shown", messageId: "sec-9", label: "Acme PSA" });
    expect((appendMessage.mock.calls[0]![1] as { secret: { product: { reason: string } } }).secret.product.reason).toBe("key_refused");
    expect(await raiseProductKeyCard({ ...base, ownerProduct: async () => ({ ok: true as const, product: { ...product, state: "connected" as const, actions: [] }, for: "pr_ann" }) }, { bot: { id: "bot-1", name: "Ada" }, threadId: "t-1", group: false, productId: "psa" })).toEqual({ kind: "connected", label: "Acme PSA" });
    expect(await raiseProductKeyCard(base, { bot: { id: "bot-1", name: "Ada" }, threadId: "t-1", group: false, productId: "psa" })).toMatchObject({ kind: "refused", status: 404 });
    expect(appendMessage).toHaveBeenCalledOnce();
  });

  it("POST /request-credential raises no product card in a routine, and says a connected product with nothing to set is connected", async () => {
    const appendMessage = vi.fn(() => ({ id: "x" }));
    const routine = call(createInternalIntegrationsRoutes(deps({ appendMessage, turnIsRoutine: () => true, ownerProduct: async () => ({ ok: true as const, product, for: "pr_ann" }) })), { path: "/api/internal/request-credential", body: { productId: "psa" } });
    await routine.run();
    expect(routine.sent[0]?.status).toBe(409);
    const connected = call(createInternalIntegrationsRoutes(deps({ appendMessage, ownerProduct: async () => ({ ok: true as const, product: { ...product, state: "connected" as const, actions: [] }, for: "pr_ann" }) })), { path: "/api/internal/request-credential", body: { productId: "psa" } });
    await connected.run();
    expect(connected.sent).toEqual([{ status: 200, body: { alreadyConfigured: true, label: "Acme PSA" } }]);
    const unknown = call(createInternalIntegrationsRoutes(deps({ appendMessage, ownerProduct: async () => ({ ok: false as const, error: "not_found" as const }) })), { path: "/api/internal/request-credential", body: { productId: "nope" } });
    await unknown.run();
    expect(unknown.sent[0]?.status).toBe(404);
    expect(String((unknown.sent[0]?.body as { error?: unknown })?.error)).toMatch(/api_list/);
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("POST /request-credential tells the bot product keys are not available yet on a deployment without the routes", async () => {
    const appendMessage = vi.fn(() => ({ id: "x" }));
    for (const ownerProduct of [async () => ({ ok: false as const, error: "unavailable" as const }), undefined]) {
      const out = call(createInternalIntegrationsRoutes(deps({ appendMessage, ...(ownerProduct ? { ownerProduct } : {}) })), { path: "/api/internal/request-credential", body: { productId: "psa" } });
      await out.run();
      expect(out.sent[0]?.status).toBe(404);
      expect(String((out.sent[0]?.body as { error?: unknown })?.error)).toMatch(/not available on this deployment yet/);
      expect(String((out.sent[0]?.body as { error?: unknown })?.error)).not.toMatch(/api_list/);
    }
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("POST /voice-note validates text (400 / 413)", async () => {
    const route = createInternalIntegrationsRoutes(deps());
    const empty = call(route, { path: "/api/internal/voice-note", body: { text: "  " } });
    await empty.run();
    expect(empty.sent[0]?.status).toBe(400);
    const long = call(route, { path: "/api/internal/voice-note", body: { text: "x".repeat(1001) } });
    await long.run();
    expect(long.sent[0]?.status).toBe(413);
  });

  it("POST /voice-note refuses when the bot turned notes off (403)", async () => {
    const route = createInternalIntegrationsRoutes(deps({
      botForThread: () => ({ ...bot, voiceNotes: false }),
    }));
    const { sent, run } = call(route, { path: "/api/internal/voice-note", body: { text: "hi" } });
    await run();
    expect(sent).toEqual([{ status: 403, body: { error: "voice notes are turned off for this bot" } }]);
  });

  it("POST /voice-note attaches audio (201)", async () => {
    const pushTurnAttachment = vi.fn();
    const route = createInternalIntegrationsRoutes(deps({ pushTurnAttachment }));
    const { sent, run } = call(route, { path: "/api/internal/voice-note", body: { text: "hello" } });
    await run();
    expect(pushTurnAttachment).toHaveBeenCalledOnce();
    expect(sent).toEqual([{ status: 201, body: { attached: true } }]);
  });

  it("POST /voice-note surfaces requireActive as 401", async () => {
    const route = createInternalIntegrationsRoutes(deps({
      requireActive: () => {
        throw Object.assign(new Error("the internal turn capability has expired"), { status: 401 });
      },
    }));
    const { sent, run } = call(route, { path: "/api/internal/voice-note", body: { text: "hello" } });
    await expect(run()).rejects.toMatchObject({ status: 401 });
    expect(sent).toEqual([]);
  });

  it("POST /perspicax/mcp refuses an unmounted account connection (403)", async () => {
    const route = createInternalIntegrationsRoutes(deps({ perspicaxMounted: () => false }));
    const { sent, run } = call(route, {
      path: "/api/internal/perspicax/mcp",
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    await run();
    expect(sent).toEqual([{
      status: 403,
      body: { error: "the Perspicax connection is not mounted in this turn", code: "profile_not_mounted" },
    }]);
  });

  it("POST /perspicax/mcp relays a frame (happy path)", async () => {
    const perspicaxRelay = vi.fn(async () => ({ status: 200, body: { jsonrpc: "2.0", id: 7, result: { ok: true } }, toolsChanged: true as const }));
    const route = createInternalIntegrationsRoutes(deps({ perspicaxRelay }));
    const { ended, run } = call(route, {
      path: "/api/internal/perspicax/mcp",
      body: { jsonrpc: "2.0", id: 7, method: "tools/list" },
    });
    await run();
    expect(perspicaxRelay).toHaveBeenCalledOnce();
    expect(ended[0]?.status).toBe(200);
    expect(ended[0]?.headers["x-sagax-mcp-tools-changed"]).toBe("1");
    expect(JSON.parse(ended[0]!.body)).toEqual({ jsonrpc: "2.0", id: 7, result: { ok: true } });
  });
});

describe("POST /mcp-servers action restart", () => {
  const mail = { command: "mail-mcp", args: [] as string[], env: { MAIL_KEY: "saved-key" }, enabled: true };

  it("reloads an enabled command server at any level, keeping its saved keys, spending no secretRef and saying what the test showed", async () => {
    for (const level of ["full", "auto", "ask"]) {
      const restartMcpServer = vi.fn(async () => ({ ok: true as const, tools: [{ name: "read_mail" }] }));
      const redeemMcpBody = vi.fn();
      const persistMcpServers = vi.fn();
      const appendMessage = vi.fn(() => ({ id: "card" }));
      const tryBeginMcpConfigUpdate = vi.fn(() => true);
      const route = createInternalIntegrationsRoutes(deps({
        mcpServers: () => ({ mail }), restartMcpServer, redeemMcpBody, persistMcpServers, appendMessage, tryBeginMcpConfigUpdate,
        sourceApprovalMode: () => level,
      }));
      const { sent, run } = call(route, { path: "/api/internal/mcp-servers", body: { action: "restart", name: "mail" } });
      await run();
      expect(sent).toEqual([{ status: 200, body: {
        name: "mail",
        restarted: true,
        text: "Restarted MCP server mail. Its saved keys stay. Test: it started and listed its tools: read_mail. That does not show what they return: call one to check. This turn keeps talking to the old process; your next turn starts the new code.",
      } }]);
      expect(restartMcpServer).toHaveBeenCalledWith("mail", bot.id);
      expect(redeemMcpBody, "no secretRef is spent").not.toHaveBeenCalled();
      expect(persistMcpServers, "nothing saved changes").not.toHaveBeenCalled();
      expect(appendMessage, "no card: it runs what is already on").not.toHaveBeenCalled();
      expect(tryBeginMcpConfigUpdate, "a restart writes no config, so it never waits on the config lock").not.toHaveBeenCalled();
    }
  });

  it("says plainly that a test only proves the server started", async () => {
    const answer = async (result: Awaited<ReturnType<NonNullable<InternalIntegrationsDeps["restartMcpServer"]>>>) => {
      const route = createInternalIntegrationsRoutes(deps({ mcpServers: () => ({ mail }), restartMcpServer: async () => result }));
      const { sent, run } = call(route, { path: "/api/internal/mcp-servers", body: { action: "restart", name: "mail" } });
      await run();
      return sent[0];
    };
    expect((await answer({ ok: true, tools: [] }))?.body).toMatchObject({ text: expect.stringContaining("Test: it started, but it has no tools.") });
    expect((await answer({ ok: false, error: "spawn mail-mcp ENOENT" }))?.body).toMatchObject({ text: expect.stringContaining("Test: it did not start: spawn mail-mcp ENOENT") });
  });

  it("answers what has no process to restart here", async () => {
    const route = createInternalIntegrationsRoutes(deps({
      mcpServers: () => ({ linear: { type: "http", url: "https://mcp.example.com/mcp", headers: {}, enabled: true }, notes: { ...mail, enabled: false } }),
      restartMcpServer: async () => null,
    }));
    const post = async (body: Record<string, unknown>) => {
      const { sent, run } = call(route, { path: "/api/internal/mcp-servers", body });
      await run();
      return sent[0];
    };
    expect(await post({ action: "restart", name: "linear" })).toMatchObject({ status: 400, body: { error: expect.stringContaining("has no process to restart") } });
    expect(await post({ action: "restart", name: "notes" })).toMatchObject({ status: 403, body: { error: "notes is off. The person turns it on in MCP server settings." } });
    expect(await post({ action: "restart", name: "missing" })).toMatchObject({ status: 404 });
    expect(await post({ action: "rename", name: "notes" })).toMatchObject({ status: 400, body: { error: "Unknown action: send add (the default) or restart." } });
  });

  it("an add with action add saves as before, the action left out of what is saved", async () => {
    const addDisabledMcpServer = vi.fn(deps().addDisabledMcpServer);
    const route = createInternalIntegrationsRoutes(deps({ addDisabledMcpServer }));
    const { sent, run } = call(route, { path: "/api/internal/mcp-servers", body: { action: "add", name: "tools", command: "npx" } });
    await run();
    expect(sent[0]?.status).toBe(201);
    expect(addDisabledMcpServer.mock.calls[0]?.[1]).toEqual({ name: "tools", command: "npx" });
  });

  it("on an organization server reloads the person's own command server through their relay", async () => {
    const closePersonalStdio = vi.fn();
    const addPersonalMcpServer = vi.fn(async () => undefined);
    const route = createInternalIntegrationsRoutes(deps({
      isPerspicax: () => true, closePersonalStdio, addPersonalMcpServer,
      personalMcpServer: (_person, name) => (name === "mail" ? mail : name === "web" ? { url: "https://mcp.example.com/mcp", enabled: true } : undefined),
    }));
    const post = async (body: Record<string, unknown>) => {
      const { sent, run } = call(route, { path: "/api/internal/mcp-servers", body });
      await run();
      return sent[0];
    };
    expect(await post({ action: "restart", name: "mail" })).toMatchObject({ status: 200, body: { restarted: true, personal: true, text: expect.stringContaining("Its saved keys stay.") } });
    expect(closePersonalStdio).toHaveBeenCalledWith("person-1", "mail");
    expect(addPersonalMcpServer).not.toHaveBeenCalled();
    expect(await post({ action: "restart", name: "web" })).toMatchObject({ status: 400 });
    expect(await post({ action: "restart", name: "missing" })).toMatchObject({ status: 404 });
  });
});
