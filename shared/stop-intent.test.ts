import { describe, expect, it } from "vitest";
import { isStopIntent } from "./stop-intent";

describe("isStopIntent", () => {
  it.each([
    "stop",
    "Stop",
    "STOP!",
    "stop.",
    "  stop  ",
    "stop it",
    "Stop it!!",
    "arrête",
    "Arrête !",
    "arrete",
    "arrête ça",
    "arrete ca",
    "Annule",
    "annuler",
    "cancel",
    "Cancel…",
    "halt",
    "please stop",
    "stop please",
    "ok stop",
    "stop svp",
    "ok, arrête",
  ])("matches %j", (text) => {
    expect(isStopIntent(text)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "stop the server when done",
    "can you cancel my order",
    "don't stop",
    "don't stop now please",
    "arrête de répondre en anglais",
    "arrête de faire ça",
    "never stop",
    "bus stop",
    "stop stop stop stop stop",
    "please please stop",
    "stopwatch",
    "cancel the meeting tomorrow",
    "annule la réunion",
    "ok",
    "please",
  ])("does not match %j", (text) => {
    expect(isStopIntent(text)).toBe(false);
  });
});
