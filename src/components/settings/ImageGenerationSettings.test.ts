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
const { AvatarImageGenerator } = await import("../AvatarImageGenerator");

const generate = () => renderToStaticMarkup(createElement(AvatarImageGenerator, {
  botLabel: "Pepper",
  disabled: false,
  generating: false,
  onGenerate: async () => {},
}));

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

describe("AvatarImageGenerator", () => {
  it("links an admin to Settings when image generation is not set up", () => {
    fixture.config = { imageGen: { configured: false, provider: "openai" } };
    const html = generate();
    expect(html).toContain("Set up image generation");
    expect(html).toContain(">Providers<");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Image provider");
    expect(html).not.toContain("Generate avatar");
  });

  it("tells an organization member the server is not set up, without a settings link", () => {
    fixture.config = { imageGen: { configured: false }, viewer: { role: "member" } };
    const html = generate();
    expect(html).toContain("Image generation is not set up on this server.");
    expect(html).not.toContain("Set up image generation");
    expect(html).not.toContain(">Models and voice<");
  });

  it("generates from a direction once the installation is configured", () => {
    fixture.config = { imageGen: { configured: true, provider: "openai" } };
    const html = generate();
    expect(html).toContain("Generate avatar");
    expect(html).toContain('aria-label="Avatar generation direction"');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Image provider");
    expect(html).not.toContain("Set up image generation");
  });
});
