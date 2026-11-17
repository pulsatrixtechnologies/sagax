import { describe, expect, it } from "vitest";

import {
  activeCount, archiveMark, capInstructions, cleanTemporaryAgent, defaultIdleHours, expired, isSurfaceBot, mayDelete, mayPin, profileSections, purgeDue, quotaKey,
  TEMP_AGENT_QUOTA, TEMP_AGENT_RETENTION_MS, temporaryOwner, type TemporaryAgent,
} from "./temporary-agents.ts";

const HOUR = 3_600_000;
const T0 = 1_791_500_000_000;
const byPerson = (owner: string, extra: Partial<TemporaryAgent> = {}): TemporaryAgent => ({
  via: "mcp", createdAt: T0, ownerPrincipalId: owner, createdBy: { kind: "person", principalId: owner }, idleHours: 24, lastActiveAt: T0, ...extra,
});

describe("temporary agents: who owns one", () => {
  it("a person's call is theirs; a bot's call is the speaker's, else the bot owner's", () => {
    expect(temporaryOwner({ kind: "person", principalId: "pr_ana" }, null)).toBe("pr_ana");
    expect(temporaryOwner({ kind: "bot", botId: "b1", speakerPrincipalId: "pr_bob" }, "pr_owner")).toBe("pr_bob");
    expect(temporaryOwner({ kind: "bot", botId: "b1" }, "pr_owner")).toBe("pr_owner");
    expect(temporaryOwner({ kind: "bot", botId: "b1" }, null)).toBeNull();
  });
});

describe("temporary agents: the quota", () => {
  it("counts the active agents of one person, never the archived ones nor another person's", () => {
    const mine = Array.from({ length: TEMP_AGENT_QUOTA }, () => byPerson("pr_ana"));
    const key = quotaKey(byPerson("pr_ana"));
    expect(activeCount(mine, key)).toBe(10);
    mine[0] = { ...mine[0]!, archived: archiveMark({ kind: "system" }, "expired", T0) };
    expect(activeCount([...mine, byPerson("pr_bob"), undefined], key)).toBe(9);
    // an ownerless agent counts against the bot that made it
    const ownerless: TemporaryAgent = { ...byPerson("x"), ownerPrincipalId: null, createdBy: { kind: "bot", botId: "b1" } };
    expect(quotaKey(ownerless)).toBe("bot:b1");
  });
});

describe("temporary agents: expiry and purge", () => {
  it("expires after idleHours without activity, unless pinned or already archived", () => {
    const agent = byPerson("pr_ana", { idleHours: 2 });
    expect(expired(agent, T0, T0 + 2 * HOUR - 1)).toBe(false);
    expect(expired(agent, T0, T0 + 2 * HOUR)).toBe(true);
    // the bot's own activity keeps it alive
    expect(expired(agent, T0 + HOUR, T0 + 2 * HOUR)).toBe(false);
    expect(expired({ ...agent, pinned: { principalId: "pr_ana", at: T0 } }, T0, T0 + 100 * HOUR)).toBe(false);
    expect(expired({ ...agent, archived: archiveMark({ kind: "system" }, "expired", T0) }, T0, T0 + 100 * HOUR)).toBe(false);
  });

  it("an archived agent is kept 30 days, then purged", () => {
    const mark = archiveMark({ kind: "person", principalId: "pr_ana" }, "deleted", T0);
    expect(mark.purgeAt - mark.at).toBe(TEMP_AGENT_RETENTION_MS);
    expect(TEMP_AGENT_RETENTION_MS).toBe(30 * 24 * HOUR);
    const agent = byPerson("pr_ana", { archived: mark });
    expect(purgeDue(agent, T0 + TEMP_AGENT_RETENTION_MS - 1)).toBe(false);
    expect(purgeDue(agent, T0 + TEMP_AGENT_RETENTION_MS)).toBe(true);
    expect(purgeDue(byPerson("pr_ana"), T0 + 10 * TEMP_AGENT_RETENTION_MS)).toBe(false);
  });

  it("reads the default expiry from SAGAX_TEMP_AGENT_IDLE_HOURS, 24 otherwise", () => {
    expect(defaultIdleHours({})).toBe(24);
    expect(defaultIdleHours({ SAGAX_TEMP_AGENT_IDLE_HOURS: "48" })).toBe(48);
    for (const bad of ["0", "721", "1.5", "soon"]) expect(defaultIdleHours({ SAGAX_TEMP_AGENT_IDLE_HOURS: bad })).toBe(24);
  });
});

describe("temporary agents: rights", () => {
  it("the owner or an organization admin deletes it; another person never", () => {
    const agent = byPerson("pr_ana");
    expect(mayDelete(agent, { kind: "person", principalId: "pr_ana", admin: false })).toBe(true);
    expect(mayDelete(agent, { kind: "person", principalId: "pr_bob", admin: false })).toBe(false);
    expect(mayDelete(agent, { kind: "person", principalId: "pr_admin", admin: true })).toBe(true);
    expect(mayDelete({ ...agent, ownerPrincipalId: null }, { kind: "person", principalId: "pr_ana", admin: false })).toBe(false);
  });

  it("a bot deletes only an agent it created itself, for the same owner", () => {
    const agent: TemporaryAgent = { ...byPerson("pr_ana"), createdBy: { kind: "bot", botId: "b1", speakerPrincipalId: "pr_ana" } };
    expect(mayDelete(agent, { kind: "bot", botId: "b1", ownerPrincipalId: "pr_ana" })).toBe(true);
    expect(mayDelete(agent, { kind: "bot", botId: "b1", ownerPrincipalId: "pr_bob" })).toBe(false);
    expect(mayDelete(agent, { kind: "bot", botId: "b2", ownerPrincipalId: "pr_ana" })).toBe(false);
    expect(mayDelete(byPerson("pr_ana"), { kind: "bot", botId: "b1", ownerPrincipalId: "pr_ana" })).toBe(false);
  });

  it("pinning is the owner's or an admin's", () => {
    expect(mayPin(byPerson("pr_ana"), { principalId: "pr_ana", admin: false })).toBe(true);
    expect(mayPin(byPerson("pr_ana"), { principalId: "pr_bob", admin: false })).toBe(false);
    expect(mayPin(byPerson("pr_ana"), { principalId: "pr_bob", admin: true })).toBe(true);
  });
});

describe("temporary agents: the stored record", () => {
  it("keeps a valid record and drops a malformed one", () => {
    const valid = { ...byPerson("pr_ana"), pinned: { principalId: "pr_ana", at: T0 }, archived: archiveMark({ kind: "bot", botId: "b1" }, "deleted", T0) };
    expect(cleanTemporaryAgent(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
    expect(cleanTemporaryAgent({ ...valid, via: "app" })).toBeUndefined();
    // its Auto workspace (create_agent workspace) is kept; anything else is dropped
    expect(cleanTemporaryAgent({ ...valid, workspace: "cloud" })).toEqual({ ...valid, workspace: "cloud" });
    expect(cleanTemporaryAgent({ ...valid, workspace: "mars" })).toEqual(valid);
    expect(cleanTemporaryAgent({ ...valid, createdBy: { kind: "robot" } })).toBeUndefined();
    expect(cleanTemporaryAgent({ ...valid, ownerPrincipalId: 5 })).toBeUndefined();
    expect(cleanTemporaryAgent(null)).toBeUndefined();
    // an out-of-range expiry falls back to the default rather than never expiring
    expect(cleanTemporaryAgent({ ...valid, idleHours: 0 })!.idleHours).toBe(24);
    // a broken archive mark is dropped, never read as "not archived forever"
    expect(cleanTemporaryAgent({ ...valid, archived: { at: T0 } })!.archived).toBeUndefined();
  });
});

describe("temporary agents: the profile sections", () => {
  it("finds the persona, rules, voice and anti-jobs by their headings, in French or English", () => {
    const soul = [
      "Tu es Orion, le répartiteur d'Acme.",
      "## Règles",
      "- Jamais de temps inventé.",
      "### Détail",
      "UTC dans ConnectWise.",
      "## Voix",
      "Français québécois, phrases courtes.",
      "## Anti-jobs",
      "Pas de facturation.",
      "## Outils",
      "ConnectWise.",
    ].join("\n");
    const sections = profileSections(soul);
    expect(sections.persona).toBe("Tu es Orion, le répartiteur d'Acme.");
    expect(sections.rules).toBe("- Jamais de temps inventé.\n### Détail\nUTC dans ConnectWise.");
    expect(sections.voice).toBe("Français québécois, phrases courtes.");
    expect(sections.anti_jobs).toBe("Pas de facturation.");
    expect(sections.headings).toEqual(["Règles", "Détail", "Voix", "Anti-jobs", "Outils"]);
    const english = profileSections("# Persona\nA clerk.\n# Rules\nBe exact.\n# Tone\nPlain.\n# What I don't do\nNo billing.");
    expect(english).toMatchObject({ persona: "A clerk.", rules: "Be exact.", voice: "Plain.", anti_jobs: "No billing." });
    expect(profileSections("")).toEqual({ persona: null, rules: null, voice: null, anti_jobs: null, headings: [] });
  });

  it("caps the instructions it returns", () => {
    expect(capInstructions("short")).toEqual({ text: "short", truncated: false });
    const long = capInstructions("x".repeat(40_000));
    expect(long.truncated).toBe(true);
    expect(long.text.length).toBeLessThan(33_000);
  });
});

describe("lot S1: a person's surface bot", () => {
  const surface = byPerson("pr_ana", { surface: true, pinned: { principalId: "pr_ana", at: T0 } });
  it("keeps its mark through a load, and an ordinary agent never gets one", () => {
    expect(cleanTemporaryAgent(surface)).toMatchObject({ surface: true, ownerPrincipalId: "pr_ana" });
    expect(cleanTemporaryAgent({ ...byPerson("pr_ana"), surface: "yes" })?.surface).toBeUndefined();
    expect(isSurfaceBot({ temporary: surface })).toBe(true);
    expect(isSurfaceBot({ temporary: byPerson("pr_ana") })).toBe(false);
    expect(isSurfaceBot({})).toBe(false);
    expect(isSurfaceBot(undefined)).toBe(false);
  });
  it("is outside the temporary agents' quota and never expires", () => {
    expect(activeCount([surface, byPerson("pr_ana")], quotaKey(surface))).toBe(1);
    const unpinned: TemporaryAgent = { ...surface };
    delete unpinned.pinned;
    expect(expired(unpinned, T0, T0 + 10_000 * HOUR)).toBe(false);
  });
});
