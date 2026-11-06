import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DeepSeekMark, PresetProviderMark, ProviderMark } from "./ProviderIcons";

describe("DeepSeek Harness in the renderer", () => {
  it("names DeepSeek as the provider behind the engine card", () => {
    const source = readFileSync(new URL("./EngineLibrary.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/deepseekAgent:\s*"DeepSeek"/);
  });

  it("draws the DeepSeek whale for the deepseekAgent driver and the deepseek preset alike", () => {
    const own = renderToStaticMarkup(createElement(DeepSeekMark, { size: 20 }));
    expect(own).toContain("<svg");
    expect(own).toContain('width="20"');
    expect(renderToStaticMarkup(createElement(ProviderMark, { driverKind: "deepseekAgent", size: 20 }))).toBe(own);
    expect(renderToStaticMarkup(createElement(PresetProviderMark, { preset: "deepseek", size: 20 }))).toBe(own);
  });
});
