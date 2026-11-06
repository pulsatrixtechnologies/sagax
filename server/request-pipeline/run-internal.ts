// @ts-nocheck
/** runInternal (#1388). Pure move from server/index.ts. */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestAuth } from "../auth/request-auth.ts";

export interface RunInternalDeps {
  COMPUTER_JOURNAL_PATH: any;
  CONFIDENTIAL_GATED_MCP_PATHS: any;
  CONFIDENTIAL_PEER_REFUSED: any;
  DATA_INTERNAL_MCP_PATH: any;
  EXTERNAL_RUNTIME_GENERATION: any;
  HOSTED_WORKSPACE: any;
  IDENTITY: any;
  INTERNAL_ROUTES: any;
  MAX_COMMS_DEPTH: any;
  PASS: any;
  PORT: any;
  activeRoutineRunForThread: any;
  actTurnFacts: any;
  agentApi: any;
  agentApiBotScopes: any;
  approvalModeForTurn: any;
  authorizedInternalCapability: any;
  beginInternalCapabilityGeneration: any;
  botActs: any;
  botmailConfined: any;
  botmailConfinedInternalRefusal: any;
  chartRenderer: any;
  cloudAgentInternalAction: any;
  cloudAgentManager: any;
  cloudGuestDriven: any;
  compileChart: any;
  confidentialInternalRefusal: any;
  confidentialPerspicaxRefusal: any;
  connectorThread: any;
  dataConfinedRoots: any;
  dataDownloadDir: any;
  dataEngine: any;
  dataExportRoots: any;
  dataRpc: any;
  dataScopeForTurn: any;
  dataSheets: any;
  DataFailure: any;
  dispatchInternalRoutes: any;
  dispatchRoutes: any;
  externalRuntimeMayCall: any;
  fillPluginBot: any;
  findWaitPeer: any;
  handleCloudAgentInternal: any;
  harnessMcpHttpKind: any;
  hostWaitRefusal: any;
  internalAgentApiTool: any;
  internalCapabilityIsActive: any;
  isInternalVoiceCallEnd: any;
  json: any;
  localPrincipalId: any;
  mcpConfidentialVerdict: any;
  mintInternalCapability: any;
  orgLibrary: any;
  reachablePeers: any;
  readAndDraft: any;
  readBody: any;
  savedSteps: any;
  serveHarnessMcpHttp: any;
  store: any;
  timingSafeEqual: any;
  turnOrigin: any;
  turnRoutineLineage: any;
  turnSpeakerPrincipals: any;
  turnSpeakers: any;
  turnSurfacePlan: any;
  validateVegaLite: any;
  voiceCalls: any;
  waitsBoot: any;
  waitSourceRefusal: any;
  z: any;
}

export function createRunInternal(getHost: () => RunInternalDeps) {
async function runInternal(req: IncomingMessage, res: ServerResponse, url: URL, path: string, method: string, auth: RequestAuth): Promise<boolean> {
  const {
    COMPUTER_JOURNAL_PATH,
    CONFIDENTIAL_GATED_MCP_PATHS,
    CONFIDENTIAL_PEER_REFUSED,
    DATA_INTERNAL_MCP_PATH,
    EXTERNAL_RUNTIME_GENERATION,
    HOSTED_WORKSPACE,
    IDENTITY,
    INTERNAL_ROUTES,
    MAX_COMMS_DEPTH,
    PASS,
    PORT,
    activeRoutineRunForThread,
    actTurnFacts,
    agentApi,
    agentApiBotScopes,
    approvalModeForTurn,
    authorizedInternalCapability,
    beginInternalCapabilityGeneration,
    botActs,
    botmailConfined,
    botmailConfinedInternalRefusal,
    chartRenderer,
    cloudAgentInternalAction,
    cloudAgentManager,
    cloudGuestDriven,
    compileChart,
    confidentialInternalRefusal,
    confidentialPerspicaxRefusal,
    connectorThread,
    dataConfinedRoots,
    dataDownloadDir,
    dataEngine,
    dataExportRoots,
    dataRpc,
    dataScopeForTurn,
    dataSheets,
    DataFailure,
    dispatchInternalRoutes,
    dispatchRoutes,
    externalRuntimeMayCall,
    fillPluginBot,
    findWaitPeer,
    handleCloudAgentInternal,
    harnessMcpHttpKind,
    hostWaitRefusal,
    internalAgentApiTool,
    internalCapabilityIsActive,
    isInternalVoiceCallEnd,
    json,
    localPrincipalId,
    mcpConfidentialVerdict,
    mintInternalCapability,
    orgLibrary,
    reachablePeers,
    readAndDraft,
    readBody,
    savedSteps,
    serveHarnessMcpHttp,
    store,
    timingSafeEqual,
    turnOrigin,
    turnRoutineLineage,
    turnSpeakerPrincipals,
    turnSpeakers,
    turnSurfacePlan,
    validateVegaLite,
    voiceCalls,
    waitsBoot,
    waitSourceRefusal,
    z
  } = getHost();

  if (method === "POST" && path === "/api/testing/org-library") {
    const expected = Buffer.from(process.env.SAGAX_TEST_ORG_LIBRARY_KEY ?? "");
    const header = req.headers["x-openmausbot-test-org-library"];
    const actual = Buffer.from(Array.isArray(header) ? "" : String(header ?? ""));
    if (expected.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected) || !orgLibrary) {
      json(res, 404, { error: "not found" });
      return true;
    }
    const body = await readBody(req);
    const applied = orgLibrary.applyRelay(body?.library ?? null);
    await orgLibrary.settled();
    json(res, applied.ok ? 200 : 400, { ...applied, report: orgLibrary.lastReport() });
    return true;
  }
  if (method === "POST" && path === "/api/testing/internal-capability") {
    const expected = process.env.SAGAX_TEST_INTERNAL_CAPABILITY_KEY ?? "";
    const actual = Array.isArray(req.headers["x-openmausbot-test-capability"])
      ? ""
      : String(req.headers["x-openmausbot-test-capability"] ?? "");
    const expectedBytes = Buffer.from(expected);
    const actualBytes = Buffer.from(actual);
    if (
      !expected ||
      actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      json(res, 404, { error: "not found" });
      return true;
    }
    const parsed = z.object({
      botId: z.string().regex(/^[\w-]{1,128}$/),
      threadId: z.string().regex(/^[\w-]{1,128}$/),
      kind: z.enum(["agents", "connectors", "computer", "data"]).default("agents"),
      depth: z.number().int().min(0).max(MAX_COMMS_DEPTH).default(0),
      skillAuthoring: z.boolean().default(false),
      // a chat turn's capability, so a test can reach coordinate_bots
      roomCoordination: z.boolean().default(false),
      deliversSavedFiles: z.boolean().default(false),
      // the person whose request this turn is, as a real turn records it
      // (bot creation judges it, server/bots/bot-creation.ts)
      speakerPrincipalId: z.string().regex(/^[\w:.@-]{1,200}$/).optional()
    }).strict().safeParse(await readBody(req));
    if (!parsed.success || !store.bot(parsed.data.botId)) {
      json(res, 400, { error: "invalid test capability" });
      return true;
    }
    const generation = beginInternalCapabilityGeneration(parsed.data.threadId);
    const { deliversSavedFiles, speakerPrincipalId, ...grants } = parsed.data;
    if (speakerPrincipalId) {
      turnSpeakers.set(parsed.data.threadId, { origin: "person", principalId: speakerPrincipalId });
      turnSpeakerPrincipals.set(parsed.data.threadId, speakerPrincipalId);
    }
    const token = mintInternalCapability({
      ...grants,
      ...(deliversSavedFiles ? { deliversSavedFiles } : {}),
      generation,
      createdBots: 0,
      openedThreads: 0
    });
    json(res, 201, { token });
    return true;
  }
  // ── internal peer-agent comms (localhost + bot capability only) ───
  // The agents-proxy (spawned inside a bot's agent process) calls these to
  // discover peers and hand a message to one. Not part of the public API.
  if (path.startsWith("/api/internal/")) {
    // The harness's browser, cloud computer and Data servers over MCP
    // streamable HTTP (server/mcp/harness-mcp-http.ts): each frame goes to the
    // route below with its bearer, through every check that follows.
    const harnessHttpKind = harnessMcpHttpKind(path);
    if (harnessHttpKind) {
      await serveHarnessMcpHttp(req, res, harnessHttpKind, `http://127.0.0.1:${PORT}`);
      return true;
    }
    const internalCapability = authorizedInternalCapability(req.headers.authorization);
    if (!internalCapability) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    const internalSender = store.bot(internalCapability.botId);
    if (!internalSender) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    // A confidential thread's turn writes nothing other people or threads
    // read: memory, logs, rules, docs, skills, routines
    // (server/threads/confidential-threads.ts).
    if (store.isConfidentialThread(internalCapability.threadId)) {
      const confidentialRefusal = confidentialInternalRefusal(path, method);
      if (confidentialRefusal) {
        json(res, 403, confidentialRefusal);
        return true;
      }
    }
    // A confined mail-woken run (S2) hands no work on: its confinement
    // would not follow it to a teammate, a room or a parallel task.
    if (botmailConfined(internalCapability.threadId)) {
      const mailRefusal = botmailConfinedInternalRefusal(path, method);
      if (mailRefusal) {
        json(res, 403, mailRefusal);
        return true;
      }
    }
    if (internalCapability.generation === EXTERNAL_RUNTIME_GENERATION && !externalRuntimeMayCall(method, path)) {
      json(res, 403, { error: "an external runtime can only list, ask and delegate to its peers and read its delegations" });
      return true;
    }
    const requiredCapabilityKind = path === "/api/internal/hook"
      ? "hooks"
      : path === "/api/internal/browser/mcp"
      ? "browser"
      : path === DATA_INTERNAL_MCP_PATH
      ? "data"
      : path === "/api/internal/phone/claim"
      ? "phone"
      : path === "/api/internal/messages/mcp"
      ? "messages"
      : path === "/api/internal/sandbox/mcp"
      ? "sandbox"
      : path === "/api/internal/desktop/mcp"
      ? "desktop"
      : path === "/api/internal/workplace/mcp"
      ? "workplace"
      : path === "/api/internal/personal-mcp"
      ? "personal-mcp"
      : path === "/api/internal/perspicax/mcp"
      ? "perspicax"
      : path.startsWith("/api/internal/connectors/")
      ? "connectors"
      : path === "/api/internal/computer-control" || path === "/api/internal/computer/mcp" || path === COMPUTER_JOURNAL_PATH
        ? "computer"
        : "agents";
    if (internalCapability.kind !== requiredCapabilityKind) {
      json(res, 403, { error: "this internal capability cannot access that service" });
      return true;
    }
    // A coordinated direct turn's ask_bot and delegate_bot are aliases of
    // coordinate_bots on the runtime (their routes' adapter); a routine or
    // webhook run thread's own direct call keeps the legacy ledger. A room
    // keeps the single teamwork path.
    if (internalCapability.roomCoordination && method === "POST" && ["/api/internal/ask-bot", "/api/internal/delegate-bot"].includes(path) &&
        store.groupByThread(internalCapability.threadId)) {
      json(res, 409, { error: "Use coordinate_bots for teamwork; it queues actual teammates and resumes you automatically." });
      return true;
    }
    // Query/body sender ids remain on the wire for proxy compatibility,
    // but the opaque bearer is the authority. Refuse disagreement instead
    // of letting a Full bot reuse its own token to impersonate a peer.
    for (const key of ["self", "fromBotId", "botId"] as const) {
      const claimed = url.searchParams.get(key);
      if (claimed !== null && claimed !== internalSender.id) {
        json(res, 403, { error: "the internal capability belongs to a different bot" });
        return true;
      }
    }
    const claimedThread = url.searchParams.get("fromThreadId");
    if (claimedThread !== null && claimedThread !== internalCapability.threadId) {
      json(res, 403, { error: "the internal capability belongs to a different conversation" });
      return true;
    }
    // read once: the confidential MCP gate below may read it before its route
    let internalBody: Promise<Record<string, unknown>> | undefined;
    const readInternalBody = () => (internalBody ??= readInternalBodyOnce());
    const readInternalBodyOnce = async () => {
      const body = await readBody(req);
      // The body may arrive slowly. Authorization at header time is not a
      // lease: if the owning turn settled while bytes were in flight, this
      // request must die before it reaches any side effect.
      if (!internalCapabilityIsActive(internalCapability)) {
        throw Object.assign(new Error("the internal turn capability has expired"), { status: 401 });
      }
      if (body && typeof body === "object" && !Array.isArray(body)) {
        for (const key of ["fromBotId", "botId"] as const) {
          if (body[key] !== undefined && String(body[key]) !== internalSender.id) {
            throw Object.assign(new Error("the internal capability belongs to a different bot"), { status: 403 });
          }
        }
        for (const key of ["fromThreadId", "threadId"] as const) {
          if (body[key] !== undefined && String(body[key]) !== internalCapability.threadId) {
            throw Object.assign(new Error("the internal capability belongs to a different conversation"), { status: 403 });
          }
        }
      }
      return body;
    };
    const requireActiveInternalCapability = () => {
      if (!internalCapabilityIsActive(internalCapability)) {
        throw Object.assign(new Error("the internal turn capability has expired"), { status: 401 });
      }
    };
    // A confidential thread's calls to other MCP servers: reads pass,
    // anything else waits for the owner's card with its exact arguments,
    // whatever the approval mode (server/threads/confidential-threads.ts).
    if (method === "POST" && CONFIDENTIAL_GATED_MCP_PATHS.has(path) && store.isConfidentialThread(internalCapability.threadId)) {
      const envelope = CONFIDENTIAL_GATED_MCP_PATHS.get(path);
      const raw: unknown = await readInternalBody();
      // a personal server's call arrives wrapped: { message: <JSON-RPC> }
      const frame: unknown = envelope === "message" && raw && typeof raw === "object" ? (raw as { message?: unknown }).message : raw;
      if (Array.isArray(frame)) {
        const answer = { jsonrpc: "2.0", id: null, error: { code: -32600, message: CONFIDENTIAL_PEER_REFUSED } };
        json(res, 200, envelope === "message" ? { message: answer } : answer);
        return true;
      }
      const call = frame && typeof frame === "object" && (frame as { method?: unknown }).method === "tools/call"
        ? (frame as { params?: { name?: unknown; arguments?: unknown } }).params : undefined;
      if (call && typeof call.name === "string") {
        const callArgs = call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments) ? call.arguments as Record<string, unknown> : undefined;
        const refused = confidentialPerspicaxRefusal(internalCapability, call.name, callArgs, (tool) => mcpConfidentialVerdict(tool), path);
        if (refused) {
          const answer = { jsonrpc: "2.0", id: (frame as { id?: unknown }).id, result: { content: [{ type: "text", text: refused }], isError: true } };
          json(res, 200, envelope === "message" ? { message: answer } : envelope === "result" ? { result: answer.result } : answer);
          return true;
        }
      }
    }
    // The agent-to-agent API (server/agent-api.ts): the bot is the caller,
    // reaching the peers its team and allow-list let it reach.
    const agentApiTool = internalAgentApiTool(method, path);
    if (agentApiTool) {
      const body = await readInternalBody();
      if (!connectorThread(internalSender.id, internalCapability.threadId)) {
        json(res, 403, { error: "source conversation does not belong to sender" });
        return true;
      }
      const aborted = new AbortController();
      res.on("close", () => aborted.abort());
      const answer = await agentApi.call({
        kind: "bot",
        id: internalSender.id,
        name: internalSender.name,
        scopes: agentApiBotScopes(internalSender),
        via: "agents-mcp",
        sourceThreadId: internalCapability.threadId,
        depth: internalCapability.depth,
        // the person the source turn speaks for: its completion turn speaks
        // for them too, so their Perspicax connectors stay mounted (production
        // 2026-10-12: unknown_speaker on the a2a wake). Never a routine's.
        ...(!turnRoutineLineage.has(internalCapability.threadId) && turnSpeakerPrincipals.get(internalCapability.threadId)
          ? { speakerPrincipalId: turnSpeakerPrincipals.get(internalCapability.threadId)! } : {})
      }, agentApiTool, body ?? {}, aborted.signal);
      json(res, answer.status, answer.body);
      return true;
    }
    const cloudAgentAction = cloudAgentInternalAction(method, path);
    if (cloudAgentAction) {
      const body = await readInternalBody();
      let principalId = turnSpeakerPrincipals.get(internalCapability.threadId);
      if (!principalId && IDENTITY.kind !== "perspicax") principalId = localPrincipalId();
      if (!principalId) {
        json(res, 403, { error: "Cloud agents need a signed-in person with provider credentials." });
        return true;
      }
      const answer = await handleCloudAgentInternal(
        cloudAgentAction,
        (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>,
        {
          manager: cloudAgentManager,
          principalId,
          botId: internalSender.id,
          threadId: internalCapability.threadId
        },
      );
      json(res, answer.isError ? 400 : 200, answer);
      return true;
    }
    if (readAndDraft.refusesRoute(internalSender, internalCapability.threadId, method, path)) {
      json(res, 403, { error: "This work reads and drafts only." });
      return true;
    }
    {
      const waitHandled = await waitsBoot.routes({
        method, path, res, json,
        botId: internalSender.id,
        threadId: internalCapability.threadId,
        readBody: readInternalBody,
        sourceRefusal: () => {
          const source = connectorThread(internalSender.id, internalCapability.threadId);
          const origin = turnOrigin(internalCapability);
          return waitSourceRefusal({
            owned: source !== null,
            room: Boolean(source?.group),
            depth: internalCapability.depth,
            handedOff: Boolean(internalCapability.roomHandoffId),
            routineRun: Boolean(activeRoutineRunForThread(internalCapability.threadId)),
            outsideDriven: origin.kind === "outside" || Boolean(internalCapability.externalRuntime),
            personStarted: origin.kind === "user",
            guest: cloudGuestDriven(internalCapability.threadId)
          });
        },
        hostRefusal: () => {
          const plan = turnSurfacePlan(internalSender, undefined, internalCapability.threadId).computer;
          const place = plan === "local" || plan === "vm" || plan === "cloud" ? plan : null;
          return hostWaitRefusal({ cloudHome: false, hosted: HOSTED_WORKSPACE, guest: cloudGuestDriven(internalCapability.threadId), place });
        },
        guest: () => cloudGuestDriven(internalCapability.threadId),
        peer: (name) => findWaitPeer(reachablePeers(store.bots, internalSender), internalSender.id, name)
      });
      if (waitHandled !== PASS) return true;
    }
    if (path === "/api/internal/act" && method === "POST") {
      const body = await readInternalBody();
      const acting = store.projectBotForTask(internalSender.id, internalCapability.threadId) ?? internalSender;
      const result = await botActs().handle({
        facts: actTurnFacts(internalCapability.threadId, internalCapability.generation),
        raw: fillPluginBot(body, internalSender.id),
        threadId: internalCapability.threadId,
        botId: internalSender.id,
        botName: acting.name,
        botColor: acting.color,
        mode: approvalModeForTurn(acting, false, internalCapability.threadId)
      });
      json(res, result.status, result.body);
      return true;
    }
    if (await dispatchRoutes([savedSteps.journalRoutes({ capability: internalCapability, readBody: readInternalBody })], { req, res, url, path, method, auth, json, readBody })) return true;
    // The cloud computer's tools (harness-mcp-proxy computer): the turn's
    // capability names its Boat, and the Boat credential stays here. A
    // capability minted before the Boat existed (boxId null) acts on the
    // one its first call's claim created or woke (mountBotBoat).
    if (method === "POST" && path === DATA_INTERNAL_MCP_PATH) {
      const body = await readInternalBody();
      const unavailable = dataEngine.unavailable();
      if (unavailable !== null) {
        json(res, 503, { error: `Data tools are unavailable: ${unavailable}` });
        return true;
      }
      const scopeKey = dataScopeForTurn(internalSender, internalCapability.threadId);
      if (scopeKey === null) {
        json(res, 403, { error: "This thread's Data belongs to another person." });
        return true;
      }
      const abort = new AbortController();
      res.once("close", () => { if (!res.writableEnded) abort.abort(); });
      let database;
      try {
        database = await dataEngine.forBot(scopeKey);
      } catch (error) {
        if (error instanceof DataFailure) {
          json(res, 503, { error: error.message });
          return true;
        }
        throw error;
      }
      requireActiveInternalCapability();
      json(res, 200, { result: await dataRpc(body, {
        database, sheet: dataSheets.for(scopeKey),
        compileChart, validateVegaLite, renderer: chartRenderer,
        exportRoots: () => dataExportRoots(internalSender, scopeKey),
        confinedRoots: () => dataConfinedRoots(scopeKey),
        downloadDir: () => dataDownloadDir(scopeKey),
        signal: abort.signal, assertActive: requireActiveInternalCapability,
        onShow: (card) => {
          // The receipt names the tool that ran; the card's title lives in
          // dataResult, where no consumer mistakes it for a status or error.
          store.appendMessage(internalCapability.threadId, {
            role: "bot", kind: "activity", tool: { name: "data_show", ok: true },
            dataResult: { botId: internalSender.id, cardId: card.id, title: card.title, kind: card.kind, sql: card.sql },
            ...(store.groupByThread(internalCapability.threadId)
              ? { from: { botId: internalSender.id, name: internalSender.name, color: internalSender.color } } : {})
          });
        }
      }) });
      return true;
    }
    if (await dispatchInternalRoutes(INTERNAL_ROUTES, { res, path, method, json, capability: internalCapability, readBody: readInternalBody, url, headers: req.headers })) return true;
    // #1388 I1: browser..computer-control moved to internal-environments
    // #1388 I5: ask-bot..create-room moved to internal-bot-chat / internal-rooms
    if (isInternalVoiceCallEnd(method, path)) {
      await readInternalBody();
      const ending = voiceCalls.requestEnd(internalCapability.threadId);
      if (!ending) {
        json(res, 409, { error: "There is no live phone call on this conversation. Do not call end_call." });
        return true;
      }
      // The goodbye is still being written. The session, the warm process
      // and the other devices wait until this turn finishes.
      json(res, 200, { ending: true, callId: ending.callId });
      return true;
    }
    // ── computer control: proxies read the hold, bots plead for help ──
    json(res, 404, { error: "unknown internal endpoint" });
    return true;
  }
  return false;
}

  return runInternal;
}
