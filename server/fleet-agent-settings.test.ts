import { describe, expect, it } from "vitest";

import { BOT_FIELD_PERMISSIONS } from "../shared/permissions.ts";
import { MEMBER_BOT_FIELDS } from "../shared/viewer-capabilities.ts";
import {
  AGENT_PRIMARY_FIELD,
  AGENT_SETTINGS_FIELDS,
  RUNTIME_SETTINGS_FIELDS,
  formatEngineCandidates,
  isRuntimeSettingsField,
  partitionAgentSettings,
  plainFieldRefusalReason,
  resolveEngineInstance,
} from "./fleet-agent-settings.ts";

describe("fleet-agent-settings (#1944)", () => {
  it("derives AGENT_SETTINGS_FIELDS from MEMBER_BOT_FIELDS and BOT_FIELD_PERMISSIONS (no drifting hand list)", () => {
    for (const field of MEMBER_BOT_FIELDS) {
      if (field === "modelSelection") {
        expect(AGENT_SETTINGS_FIELDS.includes(field)).toBe(false);
        continue;
      }
      expect(AGENT_SETTINGS_FIELDS.includes(field), field).toBe(true);
    }
    for (const field of Object.keys(BOT_FIELD_PERMISSIONS)) {
      if (field === "modelSelection" || field === "threadId") continue;
      expect(AGENT_SETTINGS_FIELDS.includes(field), field).toBe(true);
    }
    for (const field of RUNTIME_SETTINGS_FIELDS) {
      expect(AGENT_SETTINGS_FIELDS.includes(field), field).toBe(true);
      expect(isRuntimeSettingsField(field)).toBe(true);
    }
    expect(AGENT_SETTINGS_FIELDS.includes(AGENT_PRIMARY_FIELD)).toBe(true);
    expect(AGENT_SETTINGS_FIELDS.includes("modelSelection")).toBe(false);
  });

  it("resolveEngineInstance: exact id first, unique fuzzy match, ambiguous refused with candidates", () => {
    const instances = [
      { instanceId: "claude-work", driverKind: "claude", displayName: "Claude Work" },
      { instanceId: "claude-home", driverKind: "claude", displayName: "Claude Home" },
      { instanceId: "grok-main", driverKind: "grok", displayName: "Grok" },
    ];
    expect(resolveEngineInstance("claude-work", instances)).toEqual({ ok: true, instanceId: "claude-work" });
    expect(resolveEngineInstance("GROK-MAIN", instances)).toEqual({ ok: true, instanceId: "grok-main" });
    expect(resolveEngineInstance("grok", instances)).toEqual({ ok: true, instanceId: "grok-main" });

    const ambiguous = resolveEngineInstance("claude", instances);
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) {
      expect(ambiguous.reason).toBe("ambiguous");
      expect(ambiguous.candidates.map((c) => c.instanceId).sort()).toEqual(["claude-home", "claude-work"]);
      expect(formatEngineCandidates(ambiguous.candidates)).toMatch(/claude-work/);
      expect(formatEngineCandidates(ambiguous.candidates)).toMatch(/claude-home/);
    }

    const unknown = resolveEngineInstance("nope", instances);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toBe("unknown");
  });

  it("plainFieldRefusalReason strips permission keys and console paths", () => {
    expect(plainFieldRefusalReason("cwd", {
      error: "forbidden",
      permission: "folders.botWorkingFolder",
      message: "Your profile does not include folders.botWorkingFolder. Ask an admin to add it in Perspicax.",
    })).toBe("your profile does not allow changing where this bot's files live");

    expect(plainFieldRefusalReason("cloudBackend", {
      permission: "bots.computer",
      message: "See console/sagax/bots for details",
    })).toBe("your profile does not allow changing where this bot runs");

    expect(plainFieldRefusalReason("voiceNotes", {
      error: "stop this bot's turn before changing its browser access",
    })).toBe("stop this bot's turn before changing its browser access");
  });

  it("partitionAgentSettings routes runtime and primary apart from the bot PATCH", () => {
    const parts = partitionAgentSettings({
      name: "Osprey",
      voiceNotes: true,
      maxConcurrentThreads: 2,
      turnPayer: "owner",
      primary: true,
    });
    expect(parts.patch).toEqual({ name: "Osprey", voiceNotes: true });
    expect(parts.runtime).toEqual({ maxConcurrentThreads: 2, turnPayer: "owner" });
    expect(parts.primary).toBe(true);
  });
});
