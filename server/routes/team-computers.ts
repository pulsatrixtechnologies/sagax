// Named team Boats (#1388 slice P1). Independent ownership, never a hidden
// bot or an arbitrary provider id. Admin-only by default via request-auth
// (host.shell); handlers keep the content-type and lifecycle gates.
import { z } from "zod";
import { redactSecretsInText } from "../redact.ts";
import {
  teamComputerAssignment,
  teamComputerCreate,
  teamComputerOwner,
  type TeamComputerRecord,
} from "../computer/team-computers.ts";
import type { TeamComputersPayload } from "../../shared/team-computer.ts";
import { PASS, type RouteHandler } from "./table.ts";

const controlLeaseIdSchema = z.string().min(16).max(120).regex(/^[A-Za-z0-9_-]+$/);

export type TeamComputersControlSnapshot = {
  held: boolean;
};

export interface TeamComputersControl {
  snapshot(ownerKey: string): TeamComputersControlSnapshot;
  take(ownerKey: string): unknown;
  release(ownerKey: string): unknown;
  acquireLease(ownerKey: string, leaseId: string): { snapshot: TeamComputersControlSnapshot };
  releaseLease(ownerKey: string, leaseId: string): { snapshot: TeamComputersControlSnapshot };
}

export interface TeamComputersRouteDeps {
  listPayload(): Promise<TeamComputersPayload>;
  get(id: string): TeamComputerRecord | undefined;
  create(name: string, requestId: string): TeamComputerRecord;
  assign(id: string, section: string | null, sectionId?: string | null): void;
  /** #2045: resolve the caller's stable section id for a display name. */
  resolveSectionId?(section: string, auth: import("../auth/request-auth.ts").RequestAuth): string | undefined;
  setProblem(id: string, problem?: string): void;
  sections(): readonly string[];
  sectionKey(section: string | undefined): string;
  bots(): readonly { id: string; section?: string; sectionId?: string }[];
  botHasActiveTurn(botId: string): boolean;
  activeRunForBot(botId: string): unknown;
  botComputerControlSnapshot(botId: string): { held: boolean };
  computerControl: TeamComputersControl;
  sessionsIsLive(sessionId: string): boolean;
  boxProviderBusy(): boolean;
  providerTransitionMessage(): string;
  boatLifecycleBusy(ownerKey: string): boolean;
  claimLifecycle(computer: TeamComputerRecord): () => void;
  claimBotLifecycle(ownerKey: string): () => void;
  teamComputerInUse(computer: TeamComputerRecord): boolean;
  boatConfigured(): boolean;
  findBoat(ownerKey: string): Promise<unknown>;
  provisionBoat(ownerKey: string, name: string): Promise<unknown>;
  sleepBoat(ownerKey: string): Promise<unknown>;
  joinReadyBoat(ownerKey: string): Promise<unknown>;
}

export function createTeamComputersRoutes(deps: TeamComputersRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path === "/api/team-computers" && method === "GET") {
      res.setHeader("cache-control", "private, no-store");
      return json(res, 200, await deps.listPayload());
    }

    let m = path.match(/^\/api\/team-computers(?:\/([\w-]+)(?:\/(provision|join|sleep|control))?)?$/);
    if (!m) return PASS;

    const computerId = m[1];
    const action = m[2];
    let found = computerId ? deps.get(computerId) : undefined;
    if (computerId && !found) return json(res, 404, { error: "No such team computer" });
    if (method === "GET" && action === "control" && found) {
      return json(res, 200, deps.computerControl.snapshot(teamComputerOwner(found.id)));
    }
    // A GET carries no body, so the content-type gate below can only
    // mislead: the control snapshot is the sole GET on this subtree.
    if (method === "GET" && action !== "control") {
      return json(res, 404, { error: "unknown team computer action" });
    }
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    const body = await readBody(req);
    found = computerId ? deps.get(computerId) : undefined;
    const assertCurrentOwner = () => {
      if (auth.kind === "session" && !deps.sessionsIsLive(auth.session.id)) {
        throw Object.assign(new Error("Your session ended; sign in again"), { status: 401 });
      }
      if (deps.boxProviderBusy()) {
        throw Object.assign(new Error(deps.providerTransitionMessage()), { status: 409 });
      }
    };
    assertCurrentOwner();
    if (action === "control" && method === "POST" && found) {
      const parsed = z.object({ action: z.enum(["take", "release"]), controlLeaseId: controlLeaseIdSchema.optional() }).strict().safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "Choose take or release with a valid optional controlLeaseId" });
      const key = teamComputerOwner(found.id);
      if (parsed.data.action === "take" && deps.boatLifecycleBusy(key)) {
        return json(res, 409, { error: "Wait for this computer's action to finish before taking control" });
      }
      if (parsed.data.controlLeaseId) {
        const result = parsed.data.action === "take"
          ? deps.computerControl.acquireLease(key, parsed.data.controlLeaseId)
          : deps.computerControl.releaseLease(key, parsed.data.controlLeaseId);
        return json(res, 200, { ...result.snapshot, ...result });
      }
      return json(res, 200, parsed.data.action === "take" ? deps.computerControl.take(key) : deps.computerControl.release(key));
    }
    if (method === "PATCH" && found && !action) {
      const parsed = teamComputerAssignment.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "Confirm shared desktop access with section and acknowledgeSharedAccess: true" });
      const section = parsed.data.section;
      const sectionId = section === null ? undefined : deps.resolveSectionId?.(section, auth);
      const checkAssignment = () => {
        assertCurrentOwner();
        if (section !== null && section !== "" && !deps.sections().includes(section)) {
          throw Object.assign(new Error("Create the team before assigning a computer"), { status: 404 });
        }
        if (section !== null && deps.bots().some((bot) => {
          const same = sectionId
            ? bot.sectionId === sectionId || (!bot.sectionId && deps.sectionKey(bot.section) === section)
            : deps.sectionKey(bot.section) === section;
          return same && (
            deps.botHasActiveTurn(bot.id) || deps.activeRunForBot(bot.id) || deps.botComputerControlSnapshot(bot.id).held || deps.boatLifecycleBusy(bot.id)
          );
        })) {
          throw Object.assign(new Error("Stop the target team's work and release computer control before assigning this computer"), { status: 409 });
        }
      };
      checkAssignment();
      const release = deps.claimLifecycle(found);
      try {
        if (section !== null && !(await deps.findBoat(teamComputerOwner(found.id)))) {
          return json(res, 409, { error: "Create or retry this computer before assigning it to a team" });
        }
        checkAssignment();
        if (deps.teamComputerInUse(found)) return json(res, 409, { error: "This team computer became busy; stop its work before assigning it" });
        deps.assign(found.id, section, sectionId);
        return json(res, 200, { ok: true });
      } finally { release(); }
    }
    if (method === "POST" && !computerId) {
      const parsed = teamComputerCreate.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "Provide requestId (UUID), a name, and acknowledgeCost: true to create a paid cloud computer" });
      if (!deps.boatConfigured()) return json(res, 409, { error: "Configure Boat in Settings before creating a cloud computer" });
      const computer = deps.create(parsed.data.name, parsed.data.requestId);
      const release = deps.claimLifecycle(computer);
      try {
        await deps.provisionBoat(teamComputerOwner(computer.id), computer.name);
        deps.setProblem(computer.id);
        return json(res, 201, { id: computer.id });
      } catch (error) {
        deps.setProblem(computer.id, redactSecretsInText(error instanceof Error ? error.message : String(error)));
        throw error;
      } finally { release(); }
    }
    if (method === "POST" && found && action && action !== "control") {
      if (action === "provision" && (body as { acknowledgeCost?: unknown } | null)?.acknowledgeCost !== true) {
        return json(res, 400, { error: "Confirm cloud computer creation or wake costs with acknowledgeCost: true" });
      }
      // A ready-only join never wakes, provisions or steals an agent's turn.
      // The caller takes a separate explicit human-control lease first.
      if (action === "join") {
        const key = teamComputerOwner(found.id);
        if (deps.boatLifecycleBusy(key)) return json(res, 409, { error: "Wait for this computer's action to finish" });
        if (!deps.computerControl.snapshot(key).held) return json(res, 409, { error: "Take control before opening this shared desktop" });
        const release = deps.claimBotLifecycle(key);
        try { return json(res, 200, await deps.joinReadyBoat(key)); }
        finally { release(); }
      }
      const release = deps.claimLifecycle(found);
      try {
        const result = action === "provision"
          ? await deps.provisionBoat(teamComputerOwner(found.id), found.name)
          : await deps.sleepBoat(teamComputerOwner(found.id));
        deps.setProblem(found.id);
        return json(res, 200, result);
      } catch (error) {
        deps.setProblem(found.id, redactSecretsInText(error instanceof Error ? error.message : String(error)));
        throw error;
      } finally { release(); }
    }
    return json(res, 405, { error: "method not allowed" });
  };
}

