// POST /api/internal/create-bot (#1383). Matches this path itself and returns PASS otherwise.
import { fitsOnOneLine } from "../../shared/bot-profile.ts";
import type { ModelSelection } from "../../shared/model-selection.ts";
import { createdByBotMark } from "../bots/bot-creation.ts";
import { validateBotCwd } from "../bots/bot-cwd.ts";
import { recordedBotOwner } from "../bots/bot-owner.ts";
import { appendDecision } from "../decision-log.ts";
import { sectionKey } from "../store.ts";
import { MAX_CREATED_BOTS_PER_TURN, MAX_WORKSPACE_BOTS, BOTS_READ_ONLY, type InternalRoomsCall } from "./internal-rooms-types.ts";
import { PASS } from "./table.ts";

export async function handleCreateBot(call: InternalRoomsCall): Promise<typeof PASS | void> {
  const {
    res,
    path,
    method,
    json,
    internalCapability,
    readInternalBody,
    store,
    connectorThread,
    nonPrimaryCreationRefusal,
    ownerBotsReadOnly,
    personDirectTurn,
    defaultSelection,
    checkedModelSelection,
    memberOwnedInOrg,
    memberFolderRefusal,
    settleMemberAutoLevels,
    effectiveBotOwner,
    IDENTITY,
    hostedModels,
    teamSetupRequests,
    DATA_DIR,
    fullAccessForSource,
    internalCapabilityIsActive,
    internalSender,
  } = call;
  if (!(method === "POST" && path === "/api/internal/create-bot")) return PASS;
  const body = await readInternalBody();
  const chief = internalSender;
  const fromThreadId = internalCapability.threadId;
  const owner = connectorThread(chief.id, fromThreadId);
  if (!owner) {
    return json(res, 403, { error: "source conversation does not belong to sender" });
  }
  // 2026-10-17: any bot of the person, not only the Primary Bot
  // (server/bots/bot-creation.ts). The Primary Bot's path is unchanged; any
  // other bot also needs the owner's own turn, a depth and a rate.
  const primaryCreator = chief.chiefOfStaff === true;
  const creatorRefusal = () => primaryCreator ? null : nonPrimaryCreationRefusal(chief, fromThreadId, body);
  const refusedCreator = creatorRefusal();
  if (refusedCreator) return json(res, refusedCreator.status, { error: refusedCreator.error, code: refusedCreator.code });
  if (ownerBotsReadOnly(chief)) return json(res, 403, BOTS_READ_ONLY);
  if (internalCapability.createdBots >= MAX_CREATED_BOTS_PER_TURN && !personDirectTurn(chief, fromThreadId)) {
    return json(res, 429, { error: `You can create at most ${MAX_CREATED_BOTS_PER_TURN} bots in one turn that your person did not ask for directly. Use the team you have before adding more.` });
  }
  if (store.bots.length >= MAX_WORKSPACE_BOTS) {
    return json(res, 409, { error: `this workspace is limited to ${MAX_WORKSPACE_BOTS} bots` });
  }
  const name = String(body.name ?? "").trim();
  const role = String(body.role ?? "").trim();
  const instructions = String(body.instructions ?? "").trim();
  if (!name || !role || !instructions) {
    return json(res, 400, { error: "name, role, and instructions are required" });
  }
  if (name.length > 80) return json(res, 400, { error: "name must be at most 80 characters" });
  if (role.length > 120) return json(res, 400, { error: "role must be at most 120 characters" });
  // the same door the profile endpoints keep: both fields are quoted
  // into every other room member's system prompt, one line each
  if (!fitsOnOneLine(name)) return json(res, 400, { error: "name must fit on one line" });
  if (!fitsOnOneLine(role)) return json(res, 400, { error: "role must fit on one line" });
  if (instructions.length > 1_000) {
    return json(res, 400, { error: "instructions must be at most 1000 characters" });
  }
  let selection: ModelSelection;
  if (body.modelSelection === undefined) {
    selection = await defaultSelection();
    // A Primary Bot on Auto makes specialists on Auto too.
    const chiefSelection = store.projectBotForTask(chief.id, fromThreadId)?.modelSelection ?? chief.modelSelection;
    if (chiefSelection.auto === true && selection.instanceId) selection = { ...selection, auto: true };
  } else {
    const checked = checkedModelSelection(body.modelSelection, undefined, true, effectiveBotOwner(chief));
    if (!checked.ok) return json(res, checked.status, { error: checked.error });
    selection = checked.selection;
  }
  if (hostedModels && !hostedModels.allows(selection)) return json(res, 400, { error: hostedModels.error() });
  // The same check the profile path runs: absolute, exists, is a
  // folder. Creation names where the specialist works; nothing looser.
  let cwd: string | undefined;
  if (body.cwd !== undefined) {
    const checkedCwd = validateBotCwd(body.cwd);
    if (!checkedCwd.ok) return json(res, 400, { error: checkedCwd.error });
    // #1098 (isolation): a member's bot names a folder of its owner's own roots
    const outside = memberOwnedInOrg(chief) ? memberFolderRefusal(effectiveBotOwner(chief), checkedCwd.cwd) : null;
    if (outside) return json(res, 403, { ...outside, field: "cwd" });
    cwd = checkedCwd.cwd ?? undefined;
  }
  // Discovery can yield; check current authority and capacity again before writing.
  if (store.bot(chief.id) !== chief || chief.hidden || Boolean(chief.chiefOfStaff) !== primaryCreator || !connectorThread(chief.id, fromThreadId)) {
    return json(res, 403, { error: "only an active bot of yours can create bots; try again" });
  }
  const refusedLater = creatorRefusal();
  if (refusedLater) return json(res, refusedLater.status, { error: refusedLater.error, code: refusedLater.code });
  if (ownerBotsReadOnly(chief)) return json(res, 403, BOTS_READ_ONLY);
  if (internalCapability.createdBots >= MAX_CREATED_BOTS_PER_TURN && !personDirectTurn(chief, fromThreadId)) {
    return json(res, 429, { error: `You can create at most ${MAX_CREATED_BOTS_PER_TURN} bots in one turn that your person did not ask for directly. Use the team you have before adding more.` });
  }
  if (store.bots.length >= MAX_WORKSPACE_BOTS) return json(res, 409, { error: `this workspace is limited to ${MAX_WORKSPACE_BOTS} bots` });
  const duplicate = store.bots.find(
    (candidate) =>
      !candidate.hidden &&
      sectionKey(candidate.section) === sectionKey(chief.section) &&
      candidate.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) {
    return json(res, 409, { error: `@${duplicate.name} already exists in this section; use list_bots` });
  }
  // Organization server: a team setup card needs an admin's approval,
  // so a member's Primary Bot could never get its card applied. There
  // create_bot keeps Sagax's direct, safe creation (MA-4); a solo
  // server takes the reviewed card below.
  if (IDENTITY.kind === "perspicax") {
    const created = store.createBot(
      {
        name,
        title: role,
        description: instructions,
        modelSelection: selection,
        section: chief.section,
        // The request is the agents proxy on loopback: auth is not the
        // person. The Primary Bot's person owns the new bot.
        ...(recordedBotOwner(chief) ? { ownerUserId: recordedBotOwner(chief) } : {}),
        ...(cwd !== undefined ? { cwd } : {}),
        // exactly the Primary Bot's audience: a restricted Primary Bot never makes a bot everyone sees
        ...(chief.visibility ? { visibility: chief.visibility } : {}),
        // a bot made it: it cannot make more (server/bots/bot-creation.ts)
        createdByBot: createdByBotMark(chief, Date.now()),
      },
      { seedMessages: false },
    );
    // a member's Primary Bot never makes a bot on a level the
    // organization refuses for members' bots
    settleMemberAutoLevels([created.id]);
    const safeBot = store.patchBot(created.id, {
      autoApprove: false,
      approvePeerComms: false,
    })!;
    internalCapability.createdBots += 1;
    return json(res, 201, {
      id: safeBot.id,
      name: safeBot.name,
      title: safeBot.title,
      section: safeBot.section || "General",
      model: safeBot.modelSelection.model,
      modelSelection: safeBot.modelSelection,
    });
  }
  // The Primary Bot's person owns the new bot and it keeps the
  // Primary Bot's audience: applyTeamSetup records both (the request
  // is the agents proxy on loopback, never the person).
  // The same reviewed path propose_team_setup takes: Full Access (or
  // Approve for me on the person's own turn, teamSetupDirectSource)
  // applies it in this turn, anything below shows one card and creates nothing
  // until the person applies it. The instructions become the
  // specialist's standing instructions (soul).
  // A suggestion (nobody asked for this bot) always waits on the card.
  const suggestion = body.suggestion === true;
  const summary = instructions.split("\n").find((line) => line.trim())?.trim() ?? "";
  const setup = {
    botId: chief.id,
    threadId: fromThreadId,
    canCommit: () => internalCapabilityIsActive(internalCapability),
    ...(owner.group ? { from: { botId: chief.id, name: chief.name, color: chief.color } } : {}),
    plan: {
      reason: suggestion ? `@${chief.name} thinks the team needs @${name} (${role}).` : `Add @${name} (${role}) to the team.`,
      operations: [{
        action: "create",
        key: "create_bot",
        fields: {
          name,
          title: role,
          description: summary.length > 200 ? `${summary.slice(0, 199).trimEnd()}…` : summary,
          soul: instructions,
          modelSelection: selection,
          ...(cwd !== undefined ? { cwd } : {}),
        },
      }],
    },
  };
  const proposed = suggestion ? teamSetupRequests.suggest(setup) : await teamSetupRequests.submit(setup);
  if (proposed.state === "applied" || proposed.state === "pending") {
    internalCapability.createdBots += 1;
    appendDecision(DATA_DIR, { threadId: fromThreadId, requestId: proposed.requestId, botId: chief.id,
      tool: "create_bot", summary: proposed.detail, decision: proposed.state === "applied" ? "auto-approved" : "card-shown",
      source: proposed.state === "pending" ? "profile" : fullAccessForSource(chief.id, fromThreadId) ? "full-access" : "owner-auto" });
  }
  if (proposed.state === "pending") return json(res, 201, proposed);
  const createdId = "result" in proposed ? proposed.result?.bots.find((bot) => bot.action === "created")?.id : undefined;
  const created = createdId ? store.bot(createdId) : undefined;
  if (!created) return json(res, 201, proposed);
  return json(res, 201, {
    ...proposed,
    id: created.id,
    name: created.name,
    title: created.title,
    section: created.section || "General",
    model: created.modelSelection.model,
    modelSelection: created.modelSelection,
  });
}
