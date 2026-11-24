import { describe, expect, it, vi } from "vitest";

import { MinimaxDriver } from "./minimax.ts";
import {
  fetchMinimaxCatalog,
  minimaxModelsUrl,
  minimaxOptionsFromPayload,
  resetMinimaxModelCache,
} from "./minimax-models.ts";

const FALLBACK = MinimaxDriver.models;

describe("MiniMax live model list", () => {
  it("keeps a known model's context size and adds an id the written list does not name", () => {
    const options = minimaxOptionsFromPayload({
      object: "list",
      data: [
        { id: "MiniMax-M3", object: "model", owned_by: "minimax" },
        { id: "MiniMax-Future-Fixture", object: "model" },
        { id: "  ", object: "model" },
      ],
    }, FALLBACK);
    expect(options?.map((option) => option.id)).toEqual(["MiniMax-M3", "MiniMax-Future-Fixture"]);
    expect(options?.[0]).toMatchObject({ contextWindow: 1_000_000, custom: true });
    expect(options?.[1]).toMatchObject({ id: "MiniMax-Future-Fixture", label: "MiniMax-Future-Fixture", custom: true });
  });

  it("fetches GET {base}/models, caches it, and keeps the written list when the read fails", async () => {
    resetMinimaxModelCache();
    const cache = new Map<string, { at: number; options: typeof FALLBACK.options }>();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ data: [{ id: "MiniMax-M3" }, { id: "MiniMax-Next" }] }), { status: 200 });
    });
    const first = await fetchMinimaxCatalog({
      apiUrl: "https://models.example.test/v1",
      apiKey: "fixture-key",
      fallback: FALLBACK,
      fetchImpl,
      now: 1_000,
      cache,
      ttlMs: 10_000,
    });
    const second = await fetchMinimaxCatalog({
      apiUrl: "https://models.example.test/v1",
      apiKey: "fixture-key",
      fallback: FALLBACK,
      fetchImpl,
      now: 2_000,
      cache,
      ttlMs: 10_000,
    });
    expect(calls).toEqual(["https://models.example.test/v1/models"]);
    expect(first.options.map((option) => option.id)).toEqual(["MiniMax-M3", "MiniMax-Next"]);
    expect(second.default).toBe("MiniMax-M3");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const headers = new Headers((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer fixture-key");

    const failed = await fetchMinimaxCatalog({
      apiUrl: "https://models.example.test/v1",
      apiKey: "other-fixture-key",
      fallback: FALLBACK,
      fetchImpl: async () => { throw new Error("fixture-key must not surface"); },
      cache: new Map(),
    });
    expect(failed).toEqual(FALLBACK);
    expect(JSON.stringify(failed)).not.toContain("fixture-key");
  });

  it("does not send a key to a non-loopback http URL", async () => {
    expect(minimaxModelsUrl("http://models.example.test/v1")).toBeNull();
    expect(minimaxModelsUrl("http://127.0.0.1:9/v1")).toBe("http://127.0.0.1:9/v1/models");
    const fetchImpl = vi.fn();
    const catalog = await fetchMinimaxCatalog({
      apiUrl: "http://models.example.test/v1",
      apiKey: "fixture-key",
      fallback: FALLBACK,
      fetchImpl,
    });
    expect(catalog).toEqual(FALLBACK);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses a stale cache when the next read fails", async () => {
    const cache = new Map<string, { at: number; options: typeof FALLBACK.options }>();
    const ok = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "MiniMax-Next" }] }), { status: 200 }));
    await fetchMinimaxCatalog({
      apiUrl: "https://models.example.test/v1", apiKey: "fixture-key", fallback: FALLBACK, fetchImpl: ok, now: 0, cache, ttlMs: 5,
    });
    const later = await fetchMinimaxCatalog({
      apiUrl: "https://models.example.test/v1",
      apiKey: "fixture-key",
      fallback: FALLBACK,
      fetchImpl: async () => new Response("no", { status: 503 }),
      now: 10_000,
      cache,
      ttlMs: 5,
    });
    expect(later.options.map((option) => option.id)).toEqual(["MiniMax-Next"]);
  });
});
