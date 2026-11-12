import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
}));

vi.mock("@/state/store", async (importOriginal) => {
  const store = await importOriginal<typeof import("@/state/store")>();
  return {
    ...store,
    useStore: () => ({
      state: { ...store.initialState, config: fixture.config },
      dispatch: vi.fn(),
    }),
  };
});

const { ImageGenerationSettings } = await import("./ImageGenerationSettings");

describe("ImageGenerationSettings", () => {
  // 2026-10-15: no key field here; each provider's key is a row of Keys.
  it("keeps the provider here and leads to the OpenAI image key in Keys", () => {
    fixture.config = { imageGen: { configured: false, provider: "openai" } };
    const html = renderToStaticMarkup(createElement(ImageGenerationSettings));
    expect(html).toContain('aria-label="Image provider"');
    expect(html).toContain("OpenAI (images) key missing");
    expect(html).toContain('data-add-in-keys="openaiImage"');
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Save key");
    expect(html).not.toContain("Generate avatar");
  });

  it("uses the xAI row for Grok images", () => {
    fixture.config = { imageGen: { configured: true, provider: "xai", xaiConfigured: true }, xai: { configured: true } };
    const html = renderToStaticMarkup(createElement(ImageGenerationSettings));
    expect(html).toContain("Uses the xAI key from Keys.");
    expect(html).not.toContain("data-add-in-keys");
    expect(html).not.toContain('type="password"');
  });

  it("keeps the custom connection here, its optional key in Keys", () => {
    fixture.config = { imageGen: { configured: false, provider: "custom", customUrl: "", customModel: "" } };
    const html = renderToStaticMarkup(createElement(ImageGenerationSettings));
    expect(html).toContain("Base URL");
    expect(html).toContain("Save connection");
    expect(html).toContain("No key: keyless connection");
    expect(html).toContain('data-add-in-keys="customImage"');
    expect(html).not.toContain('type="password"');
  });
});
