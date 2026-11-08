import { afterEach, describe, expect, it } from "vitest";
import { en } from "@/locales";
import { setLocale } from "@/lib/i18n";
import {
  ENGINE_REMOVED_MESSAGE,
  ENGINE_REMOVED_PERSON,
  NO_ENGINE_MESSAGE,
  NO_ENGINE_PERSON,
} from "../../shared/bot-engine-error";
import { MODEL_ACCESS_DISABLED_MESSAGE } from "../../shared/model-access-disabled";
import { PARALLEL_NOT_STARTED, TURN_CUT_BY_RESTART, TURN_RESUME_FAILED_PREFIX } from "../../shared/restart-words";
import { engineErrorMessage, localizedEngineCause } from "./engine-error-text";

afterEach(() => setLocale("en"));

describe("a missing engine, in the app's language", () => {
  it("keeps the English catalog equal to the sentence the server sends", () => {
    expect(en["composer.error.noEngine"]).toBe(NO_ENGINE_PERSON);
    expect(en["composer.error.engineRemoved"]).toBe(ENGINE_REMOVED_PERSON);
  });

  it("translates the code, and the French sentence older chats stored", () => {
    setLocale("en");
    expect(engineErrorMessage({ error: NO_ENGINE_MESSAGE, code: "no_engine" })).toBe(NO_ENGINE_PERSON);
    expect(localizedEngineCause(NO_ENGINE_MESSAGE)).toBe(NO_ENGINE_PERSON);
    expect(localizedEngineCause(ENGINE_REMOVED_MESSAGE)).toBe(ENGINE_REMOVED_PERSON);
    setLocale("fr");
    expect(engineErrorMessage({ code: "no_engine", error: NO_ENGINE_PERSON })).toBe(
      "Ce bot n'a pas de moteur : choisissez-en un dans Modifier le bot > Modèle",
    );
    expect(localizedEngineCause(NO_ENGINE_MESSAGE)).toBe(
      "Ce bot n'a pas de moteur : choisissez-en un dans Modifier le bot > Modèle",
    );
    expect(localizedEngineCause(ENGINE_REMOVED_MESSAGE)).toBe(
      "Le moteur de ce bot n'est plus disponible : choisissez-en un autre dans Modifier le bot > Modèle",
    );
  });

  it("leaves every other refusal alone", () => {
    expect(engineErrorMessage({ error: "The port is taken" })).toBeNull();
    expect(engineErrorMessage(null)).toBeNull();
    expect(localizedEngineCause("rate limited")).toBeNull();
  });
});

describe("#1450 a model turned off on the paying account, in the app's language", () => {
  it("says what to do instead of the vendor's raw words", () => {
    setLocale("en");
    expect(localizedEngineCause(MODEL_ACCESS_DISABLED_MESSAGE)).toContain("Pick another model in Edit bot > Model");
    setLocale("fr");
    expect(localizedEngineCause(MODEL_ACCESS_DISABLED_MESSAGE)).toContain("Choisissez un autre modèle");
    expect(localizedEngineCause("Internal error: Upstream request failed: Model access is disabled")).toBeNull();
  });
});

describe("the lines a restart leaves, in the app's language", () => {
  it("says them in French", () => {
    setLocale("fr");
    expect(localizedEngineCause(TURN_CUT_BY_RESTART)).toBe("Tour interrompu : Sagax a redémarré");
    expect(localizedEngineCause(`${TURN_RESUME_FAILED_PREFIX}boom`)).toContain("boom");
    expect(localizedEngineCause(PARALLEL_NOT_STARTED)).not.toBe(PARALLEL_NOT_STARTED);
  });
  it("keeps the English words equal to the server's", () => {
    setLocale("en");
    expect(localizedEngineCause(TURN_CUT_BY_RESTART)).toBe(en["chat.restart.cut"]);
  });
});
