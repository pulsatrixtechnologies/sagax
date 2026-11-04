// Computer routing on an organization server (server/computer/user-computers.ts):
// only the computer of the person who asks, only while it is connected,
// through pluggable targets, never the server's own machine.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOST_COMPUTER_REFUSAL, ManagedDesktopPolicy } from "../managed-policy.ts";
import { SharedComputers } from "./shared-computers.ts";
import { createUserComputerRouter, speakingPerson, USER_COMPUTER_MESSAGES, type UserComputerProvider } from "./user-computers.ts";
import type { TurnSpeaker } from "../engines/engine-access.ts";

const ADA = "pr_11111111-1111-4111-8111-111111111111";
const BOB = "pr_22222222-2222-4222-8222-222222222222";
const secret = "a".repeat(64);
const registration = (name: string) => ({ id: randomUUID(), name, environmentId: randomUUID(), folders: [], terminal: true, computer: true });
const ada: TurnSpeaker = { origin: "person", principalId: ADA };

function desktops(live = new Set(["ada-session", "bob-session"])) {
  const broker = new SharedComputers((id) => live.has(id));
  const adaDesktop = registration("Ada's Mac");
  const bobDesktop = registration("Bob's PC");
  broker.register(adaDesktop, { session: "ada-session", person: ADA }, secret);
  broker.register(bobDesktop, { session: "bob-session", person: BOB }, secret);
  // as server/index.ts builds it over the owner-scoped broker
  const provider: UserComputerProvider<unknown, never> = {
    target: "user-desktop",
    list: (person) => broker.list(person),
    owns: (person, id) => broker.list(person).some((computer) => computer.id === id),
    request: (person, operation, active) => broker.request(operation, person, active),
  };
  return { broker, adaDesktop, bobDesktop, provider, live };
}

describe("whose computer a bot may use", () => {
  it("a person's own message, or a bot hop carrying it; never a routine, the operator or an unattributed hop", () => {
    expect(speakingPerson({ origin: "person", principalId: ` ${ADA.toUpperCase()} ` })).toBe(ADA);
    expect(speakingPerson({ origin: "peer", fromBotId: "b1", principalId: ADA })).toBe(ADA);
    expect(speakingPerson({ origin: "peer", fromBotId: "b1", principalId: ADA, routine: true })).toBeNull();
    expect(speakingPerson({ origin: "peer", fromBotId: "b1" })).toBeNull();
    expect(speakingPerson({ origin: "owner-routine" })).toBeNull();
    expect(speakingPerson({ origin: "operator" })).toBeNull();
    expect(speakingPerson({ origin: "person" })).toBeNull();
    expect(speakingPerson(undefined)).toBeNull();
  });

  it("a routine of the person's own bot, run as them, scheduled or by hand, reaches the computer they shared (2026-10-26)", async () => {
    for (const automationTrigger of ["schedule", "manual"]) {
      const own = { botOwner: ADA, automationTrigger };
      expect(speakingPerson({ origin: "owner-routine", principalId: ADA }, own)).toBe(ADA);
      expect(speakingPerson({ origin: "peer", fromBotId: "b1", routine: true, routinePayer: ADA }, own)).toBe(ADA);
      expect(speakingPerson({ origin: "peer", fromBotId: "b1", principalId: ADA, routine: true, routinePayer: ADA }, own)).toBe(ADA);
    }
    const { broker, adaDesktop, provider } = desktops();
    const router = createUserComputerRouter([provider]);
    const routine: TurnSpeaker = { origin: "owner-routine", principalId: ADA };
    expect(router.list(routine, { botOwner: ADA, automationTrigger: "schedule" })).toEqual([{ target: "user-desktop", computer: adaDesktop }]);
    broker.close();
  });

  it("never a routine run as someone else, a webhook, an unknown start, or someone else's routine", async () => {
    const schedule = { botOwner: ADA, automationTrigger: "schedule" };
    // run as another person, or as nobody known
    expect(speakingPerson({ origin: "owner-routine", principalId: BOB }, schedule)).toBeNull();
    expect(speakingPerson({ origin: "owner-routine" }, schedule)).toBeNull();
    // a webhook, a typed trigger, an unknown start
    for (const automationTrigger of ["webhook", "graph", undefined]) {
      expect(speakingPerson({ origin: "owner-routine", principalId: ADA }, { botOwner: ADA, ...(automationTrigger ? { automationTrigger } : {}) })).toBeNull();
      expect(speakingPerson({ origin: "peer", fromBotId: "b1", routine: true, routinePayer: ADA }, { botOwner: ADA, ...(automationTrigger ? { automationTrigger } : {}) })).toBeNull();
    }
    // a routine someone else pays for, or carrying someone else's words
    expect(speakingPerson({ origin: "peer", fromBotId: "b1", routine: true, routinePayer: BOB }, schedule)).toBeNull();
    expect(speakingPerson({ origin: "peer", fromBotId: "b1", principalId: BOB, routine: true, routinePayer: ADA }, schedule)).toBeNull();
    // a routine of Bob's bot never reaches Ada's computer, and Ada's routine never Bob's
    expect(speakingPerson({ origin: "owner-routine", principalId: ADA }, { botOwner: BOB, automationTrigger: "schedule" })).toBeNull();
    const { broker, bobDesktop, provider } = desktops();
    const router = createUserComputerRouter([provider]);
    await expect(router.request({ origin: "owner-routine", principalId: ADA }, { computer_id: bobDesktop.id, action: "list_files" } as never, () => true, schedule))
      .rejects.toMatchObject({ status: 403, code: "not_theirs" });
    expect(() => router.list({ origin: "owner-routine", principalId: ADA }, { botOwner: ADA, automationTrigger: "webhook" })).toThrow(USER_COMPUTER_MESSAGES.noPerson);
    broker.close();
  });

  it("lists only the speaker's connected computers", () => {
    const { broker, adaDesktop, provider } = desktops();
    const router = createUserComputerRouter([provider]);
    expect(router.list(ada)).toEqual([{ target: "user-desktop", computer: adaDesktop }]);
    expect(broker.list(BOB)).toHaveLength(1);
    broker.close();
  });

  it("runs an action on the speaker's own computer and never on someone else's", async () => {
    const { broker, adaDesktop, bobDesktop, provider } = desktops();
    const router = createUserComputerRouter([provider]);
    await expect(router.request(ada, { computer_id: bobDesktop.id, action: "run_command", command: "id" } as never, () => true))
      .rejects.toMatchObject({ status: 403, code: "not_theirs", message: USER_COMPUTER_MESSAGES.notTheirs });
    const pending = router.request(ada, { computer_id: adaDesktop.id, action: "run_command", command: "pwd" } as never, () => true);
    const job = await broker.poll(adaDesktop.id, "ada-session", secret);
    expect(job?.operation).toMatchObject({ computer_id: adaDesktop.id, action: "run_command" });
    // Bob's desktop was never handed the job
    expect(broker.liveJob(bobDesktop.id, "bob-session", secret, job!.id)).toBe(false);
    broker.complete(adaDesktop.id, "ada-session", secret, job!.id, { ok: true });
    await expect(pending).resolves.toEqual({ ok: true });
    broker.close();
  });

  it("says so when the speaker's desktop is not connected, and offers nothing else instead", async () => {
    const { broker, adaDesktop, provider, live } = desktops();
    live.delete("ada-session");
    const router = createUserComputerRouter([provider]);
    expect(() => router.list(ada)).toThrow(USER_COMPUTER_MESSAGES.notConnected);
    await expect(router.request(ada, { computer_id: adaDesktop.id, action: "list_files" } as never, () => true))
      .rejects.toMatchObject({ status: 409, code: "not_connected", message: USER_COMPUTER_MESSAGES.notConnected });
    broker.close();
  });

  it("names the settings row, and says an administrator has to enable computer access when the server has it off (#1805)", () => {
    const { broker, provider, live } = desktops();
    live.delete("ada-session");
    const offered = createUserComputerRouter([provider], { sharingOffered: () => true });
    expect(() => offered.list(ada)).toThrow(USER_COMPUTER_MESSAGES.notConnected);
    const refused = createUserComputerRouter([provider], { sharingOffered: () => false });
    expect(() => refused.list(ada)).toThrow(USER_COMPUTER_MESSAGES.notAccepted);
    for (const message of [USER_COMPUTER_MESSAGES.notConnected, USER_COMPUTER_MESSAGES.notAccepted, HOST_COMPUTER_REFUSAL]) {
      expect(message).toContain("This computer for your bots");
      expect(message).toContain("Cet ordinateur pour vos bots");
      expect(message).not.toContain("Share this computer");
    }
    expect(USER_COMPUTER_MESSAGES.notConnected).toContain("Choose access");
    expect(USER_COMPUTER_MESSAGES.notAccepted).toContain("administrator");
    expect(USER_COMPUTER_MESSAGES.notAccepted).toContain("cannot turn it on");
    broker.close();
  });

  it("refuses a turn no person asked for", async () => {
    const { broker, adaDesktop, provider } = desktops();
    const router = createUserComputerRouter([provider]);
    for (const speaker of [{ origin: "owner-routine" } as TurnSpeaker, { origin: "operator" } as TurnSpeaker, undefined]) {
      expect(() => router.list(speaker)).toThrow(USER_COMPUTER_MESSAGES.noPerson);
      await expect(router.request(speaker, { computer_id: adaDesktop.id } as never, () => true)).rejects.toMatchObject({ code: "no_person" });
    }
    broker.close();
  });

  it("routes to whichever target holds the computer: a user sandbox plugs in beside the desktop", async () => {
    const { broker, adaDesktop, provider } = desktops();
    const sandboxCalls: unknown[] = [];
    const sandbox: UserComputerProvider<unknown, never> = {
      target: "user-sandbox",
      list: (person) => (person === ADA ? [{ id: "sandbox-ada" }] : []),
      owns: (person, id) => person === ADA && id === "sandbox-ada",
      request: async (person, operation) => { sandboxCalls.push([person, operation]); return { sandbox: true }; },
    };
    const router = createUserComputerRouter([provider, sandbox]);
    expect(router.list(ada).map((entry) => entry.target)).toEqual(["user-desktop", "user-sandbox"]);
    await expect(router.request(ada, { computer_id: "sandbox-ada" } as never, () => true)).resolves.toEqual({ sandbox: true });
    expect(sandboxCalls).toEqual([[ADA, { computer_id: "sandbox-ada" }]]);
    // Bob has no sandbox and no desktop of his own here
    expect(() => router.list({ origin: "person", principalId: "pr_33333333-3333-4333-8333-333333333333" })).toThrow(USER_COMPUTER_MESSAGES.notConnected);
    expect(adaDesktop).toBeTruthy();
    broker.close();
  });
});

describe("the server's own machine on an organization server", () => {
  it("is refused for this computer and a local VM, every other kind follows the organisation's policy", () => {
    const org = new ManagedDesktopPolicy({ hostComputersAllowed: () => false });
    const solo = new ManagedDesktopPolicy();
    for (const kind of ["thisComputer", "localVm"] as const) {
      expect(org.computerAllowed(kind)).toBe(false);
      expect(org.computerRefusal(kind)).toBe(HOST_COMPUTER_REFUSAL);
      expect(solo.computerAllowed(kind)).toBe(true);
      expect(solo.computerRefusal(kind)).toBeUndefined();
    }
    for (const kind of ["box", "vps"] as const) {
      expect(org.computerAllowed(kind)).toBe(true);
      expect(org.computerRefusal(kind)).toBeUndefined();
    }
    org.close(); solo.close();
  });

  it("is wired to the organization identity and guards every host path", () => {
    const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    expect(source).toMatch(/hostComputersAllowed: \(\) => IDENTITY\.kind !== "perspicax"/);
    // every computer claim (host screen, local VMs) passes the policy
    expect(source).toMatch(/async function bindTurnComputer\([^)]*\)[^{]*\{[\s\S]{0,300}computerPlaceRefusal\(kind\)/);
    expect(source).toMatch(/function computerPlaceRefusal\([\s\S]{0,400}managedPolicy\.computerRefusal\(kind\)/);
    // The VM routes moved out of index.ts in 062d7c42e. Check both the
    // policy injection and the refusal at each extracted host entry point.
    const routes = readFileSync(new URL("../routes/local-computer.ts", import.meta.url), "utf8");
    expect(source).toMatch(/createLocalComputerRoutes\(\{[\s\S]*?hostRefusal: hostComputerRefusal,/);
    expect(routes).toMatch(/const hostVmRefusal = action === "stop" \|\| action === "remove" \? undefined : deps\.hostRefusal\(\);/);
    expect(routes).toMatch(/if \(hostVmRefusal\) return json\(res, 403, \{ error: hostVmRefusal, code: "host_computer" \}\);/);
    expect(routes).toMatch(/const botVmRefusal = action === "run" \|\| action === "start" \? deps\.hostRefusal\(\) : undefined;/);
    expect(routes).toMatch(/if \(botVmRefusal\) return json\(res, 403, \{ error: botVmRefusal, code: "host_computer" \}\);/);
    // the internal route answers the proven requester's computers on an organization server
    // (2026-10-26, #1138: with no person speaking, the turn's own speaker and
    // the bot's owner and routine trigger, so the person's own routine reaches
    // the computer they lent; userComputers decides, see the routine cases above)
    expect(source).toMatch(/function userComputerSpeaking\(principal: string \| null[\s\S]{0,300}?\{\s*if \(principal\) return \{ speaker: personSpeaker\(principal\), context: \{\} \};/);
    const environments = readFileSync(new URL("../routes/internal-environments.ts", import.meta.url), "utf8");
    expect(source).toMatch(/userComputerSpeaking: \(principal, capability\) => userComputerSpeaking\(principal, capability\)/);
    expect(source).toMatch(/userComputersList: \(speaker, context\) => userComputers\.list\(speaker as never, context as never\)/);
    expect(source).toMatch(/userComputersRequest: \(speaker, operation, active, context\) => userComputers\.request\(speaker as never, operation as never, active, context as never\)/);
    expect(environments).toMatch(/const \{ speaker: computerSpeaker, context: computerContext \} = deps\.userComputerSpeaking\(principal, capability\);\s*return json\(res, 200, \{\s*computers: deps\.userComputersList\(computerSpeaker, computerContext\)/);
    expect(environments).toMatch(/deps\.userComputersRequest\(computerSpeaker, parsed\.data, active, computerContext\)/);
    // only a person may lend a computer to an organization server
    const lending = readFileSync(new URL("../routes/shared-computers-http.ts", import.meta.url), "utf8");
    expect(source).toMatch(/createSharedComputersRoutes\(\{[\s\S]*?identityKind: \(\) => IDENTITY\.kind/);
    expect(lending).toMatch(/deps\.identityKind\(\) === "perspicax" && !auth\.session\.principalId\) \{\s*return json\(res, 403/);
  });
});
