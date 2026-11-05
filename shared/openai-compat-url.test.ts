import { describe, expect, it } from "vitest";

import { stripOpenAiEndpointSuffix } from "./openai-compat-url.ts";

describe("stripOpenAiEndpointSuffix (#2022)", () => {
  it("keeps a pasted endpoint as its API base", () => {
    expect(stripOpenAiEndpointSuffix("https://provider.example/v1/chat/completions")).toBe("https://provider.example/v1");
    expect(stripOpenAiEndpointSuffix("https://provider.example/v1/chat/completions/")).toBe("https://provider.example/v1");
    expect(stripOpenAiEndpointSuffix("https://provider.example/chat/completions")).toBe("https://provider.example");
    expect(stripOpenAiEndpointSuffix("https://provider.example/v1/completions")).toBe("https://provider.example/v1");
    expect(stripOpenAiEndpointSuffix("https://provider.example/v1/responses")).toBe("https://provider.example/v1");
    expect(stripOpenAiEndpointSuffix("https://provider.example/v1/models")).toBe("https://provider.example/v1");
    expect(stripOpenAiEndpointSuffix("https://provider.example/compatibility/v1/models/")).toBe("https://provider.example/compatibility/v1");
  });

  it("leaves a real base URL alone, including Cohere's /compatibility/v1", () => {
    expect(stripOpenAiEndpointSuffix("https://provider.example/v1")).toBe("https://provider.example/v1");
    expect(stripOpenAiEndpointSuffix("https://provider.example/v1/")).toBe("https://provider.example/v1");
    expect(stripOpenAiEndpointSuffix("https://provider.example/compatibility/v1")).toBe("https://provider.example/compatibility/v1");
    expect(stripOpenAiEndpointSuffix("  https://provider.example/v1///  ")).toBe("https://provider.example/v1");
  });
});
