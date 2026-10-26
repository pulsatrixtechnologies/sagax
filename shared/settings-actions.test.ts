import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { settingsDoc } from "../scripts/settings-actions/doc.ts";
import { DEVICE_PREFERENCE_KEYS, SETTING_FAMILIES, SETTINGS, pickValue, settingSpec, valueFits } from "./settings-actions.ts";
import { USER_PREFERENCE_KEYS } from "./user-preferences.ts";
import { uiCommandToAction } from "./bot-act.ts";
import { decideSettingEffect } from "./settings-actions-policy.ts";

describe("the settings registry", () => {
  it("names each setting once, in a known family, with a route for any value it takes", () => {
    const keys = SETTINGS.map((spec) => spec.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const spec of SETTINGS) {
      expect(SETTING_FAMILIES, spec.key).toContain(spec.family);
      expect(spec.key.length, spec.key).toBeLessThanOrEqual(64);
      const built = spec.write({ target: "t1", botId: "b1" }, true);
      expect(built, spec.key).toBeTruthy();
      if (typeof built === "object" && "path" in built) expect(built.path, spec.key).toMatch(/^\/api\//);
    }
    for (const family of SETTING_FAMILIES) expect(SETTINGS.some((spec) => spec.family === family), family).toBe(true);
  });

  it("covers what JC listed: model, effort, approval level, managed teams, title, persona, mascot, skin, routine schedule, conversation, on/off and engine", () => {
    for (const key of ["bot.model", "bot.effort", "bot.approvalMode", "bot.managedSections", "bot.title", "bot.persona", "bot.mascot", "bot.skin",
      "routine.schedule", "routine.thread", "routine.enabled", "routine.engine", "group.name", "section.bots", "org.allowFullAccess",
      "credentials.item", "connections.mcpServer", "notifications.sounds", "appearance.skin", "server.showToolCalls"]) {
      expect(settingSpec(key), key).toBeDefined();
    }
  });

  it("classes a secret, another person, a deletion and the organization as such", () => {
    const classes = (key: string, organization = false) => settingSpec(key)!.classes?.(null, { organization }) ?? ["own"];
    expect(classes("credentials.item")).toContain("secret");
    expect(classes("bot.share")).toContain("others");
    expect(classes("routine.delete")).toContain("delete");
    expect(classes("org.allowFullAccess")).toContain("org");
    expect(classes("server.showToolCalls")).toEqual(["own"]);
    expect(classes("server.showToolCalls", true)).toEqual(["org"]);
    expect(classes("bot.approvalMode")).toEqual(["rule-change"]);
    expect(classes("bot.name")).toEqual(["own"]);
  });

  it("bot.teamMemorySharing: an enum; widening back to shared waits on a card at every level, narrowing to private runs", () => {
    const spec = settingSpec("bot.teamMemorySharing")!;
    expect(spec.value).toBe("enum:shared|private");
    expect(valueFits(spec.value, "shared")).toBe(true);
    expect(valueFits(spec.value, "private")).toBe(true);
    for (const bad of ["everyone", "Private", "", null, true]) expect(valueFits(spec.value, bad), JSON.stringify(bad)).toBe(false);
    for (const ctx of [{ organization: false }, { organization: true }, { organization: false, self: true }]) {
      expect(spec.classes!("shared", ctx), JSON.stringify(ctx)).toEqual(["others"]);
      expect(spec.classes!("private", ctx), JSON.stringify(ctx)).toEqual(["own"]);
    }
    for (const mode of ["auto", "full"] as const) {
      // the bot itself, at its owner's Auto or Full: private -> shared asks, shared -> private runs
      expect(decideSettingEffect({ classes: spec.classes!("shared", { organization: false, self: true }), mode, ownerWork: true, keyProtected: false }), mode)
        .toEqual({ effect: "hold", reason: "sensitive" });
      expect(decideSettingEffect({ classes: spec.classes!("private", { organization: false, self: true }), mode, ownerWork: true, keyProtected: false }), mode)
        .toEqual({ effect: "run" });
    }
    // even when the person asked their Primary Bot for it in this turn
    expect(decideSettingEffect({ classes: spec.classes!("shared", { organization: false }), mode: "full", ownerWork: true, keyProtected: false, personAsked: true }))
      .toEqual({ effect: "hold", reason: "sensitive" });
    expect(spec.write({ target: "b1" }, "private")).toEqual({ method: "PATCH", path: "/api/bots/b1", body: { teamMemorySharing: "private" } });
  });

  it("writes the managed teams with the screen's acknowledgement and Full with its confirmation", () => {
    expect(settingSpec("bot.managedSections")!.write({ target: "b1" }, ["Built-in"])).toEqual({ method: "PATCH", path: "/api/bots/b1", body: { managedSections: ["Built-in"], acknowledgePeerScope: true } });
    expect(settingSpec("bot.approvalMode")!.write({ target: "b1" }, "full")).toEqual({ method: "PATCH", path: "/api/bots/b1", body: { approvalMode: "full", confirmFullAccess: true } });
    expect(settingSpec("routine.thread")!.write({ target: "r1" }, "th")).toEqual({ method: "PATCH", path: "/api/routines/r1", body: { resultsThreadId: "th" } });
  });

  it("checks a value's kind", () => {
    expect(valueFits("enum:ask|auto", "auto")).toBe(true);
    expect(valueFits("enum:ask|auto", "full")).toBe(false);
    expect(valueFits("string?", null)).toBe(true);
    expect(valueFits("string", null)).toBe(false);
    expect(valueFits("object", [])).toBe(false);
    expect(valueFits("boolean", "true")).toBe(false);
  });

  it("picks a value at a dot path and in a list", () => {
    const bot = { modelSelection: { effort: "high" }, tasks: [{ threadId: "a", title: "One" }, { threadId: "b", title: "Two" }] };
    expect(pickValue(bot, "modelSelection.effort")).toBe("high");
    expect(pickValue(bot, "tasks[threadId=b].title")).toBe("Two");
    expect(pickValue(bot, "tasks[threadId=z].title")).toBeUndefined();
  });

  it("lets a bot set only the device preferences the registry names", () => {
    expect(DEVICE_PREFERENCE_KEYS.has("omb-skin")).toBe(true);
    expect(uiCommandToAction("setPreference", { key: "omb-skin", value: "night" })).toMatchObject({ write: true });
    expect(uiCommandToAction("setPreference", { key: "sagax.botWorkplace.v1", value: "{}" })).not.toBeNull();
    expect(uiCommandToAction("setPreference", { key: "openmausbot.sidebarWidth", value: "1" })).toBeNull();
    expect(uiCommandToAction("setPreference", { key: "credentials", value: "x" })).toBeNull();
    // a synced key the person changes by hand is a key the bot may set too
    for (const key of DEVICE_PREFERENCE_KEYS) expect(key.length).toBeGreaterThan(0);
    expect([...DEVICE_PREFERENCE_KEYS].filter((key) => (USER_PREFERENCE_KEYS as readonly string[]).includes(key)).length).toBeGreaterThan(10);
  });

  it("docs/settings-actions.md is the registry's inventory (pnpm gen:settings-doc)", () => {
    expect(readFileSync(new URL("../docs/settings-actions.md", import.meta.url), "utf8")).toBe(settingsDoc());
  });

  it("gives each 2E option its key: accessibility, time zone, desktop shell, notification sound, other computers", () => {
    for (const key of ["appearance.reduceMotion", "appearance.highContrast", "appearance.textSize", "appearance.hardwareAcceleration", "appearance.spellcheck",
      "notifications.soundChoice", "account.timeZone", "account.timeZoneAuto", "computer.rename", "computer.remove"]) {
      expect(settingSpec(key), key).toBeDefined();
    }
    for (const storage of ["sagax.a11y.motion.v1", "sagax.a11y.contrast.v1", "sagax.a11y.textSize.v1", "sagax.hardwareAcceleration.v1", "sagax.spellcheck.v1", "sagax.notificationSound.v1"]) {
      expect(DEVICE_PREFERENCE_KEYS.has(storage), storage).toBe(true);
    }
    // the ones that follow the person to another device
    for (const storage of ["sagax.a11y.motion.v1", "sagax.a11y.contrast.v1", "sagax.a11y.textSize.v1", "sagax.notificationSound.v1"]) {
      expect((USER_PREFERENCE_KEYS as readonly string[]).includes(storage), storage).toBe(true);
    }
    expect(settingSpec("account.timeZone")!.write({}, "America/Toronto")).toEqual({ method: "PUT", path: "/api/settings/bot", body: { timeZone: "America/Toronto", timeZoneAuto: false } });
    expect(settingSpec("account.timeZoneAuto")!.write({}, true)).toEqual({ method: "PUT", path: "/api/settings/bot", body: { timeZoneAuto: true } });
    expect(settingSpec("computer.rename")!.write({}, { computer: "Office PC", name: "Desk" })).toEqual({ method: "POST", path: "/api/me/desktop-bridge/computers/rename", body: { computer: "Office PC", name: "Desk" } });
    expect(settingSpec("computer.remove")!.write({}, "Office PC")).toEqual({ method: "POST", path: "/api/me/desktop-bridge/computers/remove", body: { computer: "Office PC" } });
    expect(settingSpec("computer.remove")!.classes?.(null, { organization: true })).toEqual(["delete"]);
    expect(settingSpec("appearance.textSize")!.write({}, "large")).toEqual({ ui: "setPreference", input: { key: "sagax.a11y.textSize.v1", value: "large" } });
  });
});
