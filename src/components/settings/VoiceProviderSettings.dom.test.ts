// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VOICE_MODE_STORAGE_KEY } from "../../../shared/voice-mode";
import { setLocale } from "@/lib/i18n";
import { readVoiceModeSettings, voiceSettingsForBot } from "@/lib/voice-mode/settings";

// Keep the component's hooks, requests and preference writes real; native
// selects stand in for the shared popover control.
vi.mock("../SettingsPrimitives", () => {
  const row = ({ children, rowId, description }: { children?: ReactNode; rowId?: string; description?: ReactNode }) => createElement("div", { "data-row-id": rowId }, description, children);
  return {
    CompactRow: row, DescribedRow: row, SettingsGroup: row, GROUP_CARD: "", PILL: "",
    PillSelect: ({ value, options, onChange, disabled }: { value: string; options: Array<{ value: string; label: string }>; onChange(value: string): void; disabled?: boolean }) =>
      createElement("select", { value, disabled, onChange: (event: { target: { value: string } }) => onChange(event.target.value) },
        options.map((option) => createElement("option", { key: option.value, value: option.value }, option.label))),
  };
});

import { VoiceProviderSettings } from "./VoiceProviderSettings";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  setLocale("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const select = (row: string) => container.querySelector(`[data-row-id="${row}"] select`) as HTMLSelectElement;
const choose = (row: string, value: string) => act(() => {
  const field = select(row);
  field.value = value;
  field.dispatchEvent(new Event("change", { bubbles: true }));
});

it.each([false, true])("switches OpenAI to Auto's resolved xAI voice without waiting for preference sync (bot=%s)", async (forBot) => {
  const preference = { voice: "ara", speed: 1, language: "auto", ...(!forBot ? { tts: "openai" } : {}), voices: { openai: "cedar" },
    ...(forBot ? { bots: { "b-1": { tts: "openai", voices: { openai: "cedar" } } } } : {}) };
  localStorage.setItem(VOICE_MODE_STORAGE_KEY, JSON.stringify(preference));
  let finishAuto: (() => void) | undefined;
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input), "http://fixture.test");
    if (url.pathname.endsWith("/status")) {
      const choice = url.searchParams.get("tts") ?? "openai"; // the server's saved preference is still OpenAI
      const response = () => Response.json({ provider: "xai", available: true, tts: choice === "auto" ? "xai" : choice, stt: "xai",
        providers: { tts: ["xai", "openai"], stt: ["xai"] } });
      if (choice === "auto") return new Promise<Response>((resolve) => { finishAuto = () => resolve(response()); });
      return response();
    }
    if (url.pathname.endsWith("/voices")) return Response.json({ voices: url.searchParams.get("provider") === "xai"
      ? [{ id: "ara", label: "Ara" }, { id: "eve", label: "Eve" }] : [{ id: "cedar", label: "Cedar" }] });
    throw new Error(`Unexpected fixture route ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetch);
  act(() => root.render(createElement(VoiceProviderSettings, forBot ? { bot: { id: "b-1", name: "Example" } } : {})));
  await flush();
  expect(container.querySelector("[data-voice-provider-voice]")?.getAttribute("data-voice-provider-voice")).toBe("openai");
  expect(select("voiceProviders.voice").value).toBe("cedar");
  choose("voiceProviders.tts", forBot ? "inherit" : "auto");
  await flush();
  expect(select("voiceProviders.voice").disabled).toBe(true);
  expect(finishAuto).toBeDefined();
  await act(async () => finishAuto!());
  await flush();
  expect(container.querySelector("[data-voice-provider-voice]")?.getAttribute("data-voice-provider-voice")).toBe("xai");
  // #2080 (L1): Auto names the provider it picked
  expect(container.querySelector('[data-row-id="voiceProviders.tts"] [data-voice-effective]')?.textContent).toBe("Auto · xAI");
  expect(container.querySelector('[data-row-id="voiceProviders.stt"] [data-voice-effective]')?.textContent).toBe("Auto · xAI");
  choose("voiceProviders.voice", "eve");
  const saved = JSON.parse(localStorage.getItem(VOICE_MODE_STORAGE_KEY)!);
  expect(voiceSettingsForBot(readVoiceModeSettings(), forBot ? "b-1" : undefined).tts).toBe("auto");
  if (forBot) expect(saved.bots["b-1"]).toEqual({ voices: { xai: "eve", openai: "cedar" } });
  else expect(saved).toMatchObject({ voice: "eve", voices: { openai: "cedar" } });
});
