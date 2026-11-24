import { describe, expect, it } from "vitest";

import {
  CLINE_MODELS_ENDPOINT,
  clineCatalogFromSession,
  clineFallbackCatalog,
  clineTurnModel,
} from "./cline-models.ts";

describe("Cline model list", () => {

  it("has no HTTP models endpoint", () => {
    expect(CLINE_MODELS_ENDPOINT).toBeNull();
  });

  it("keeps the configured entry until a session lists models", () => {
    expect(clineCatalogFromSession([])).toBeNull();
    expect(clineCatalogFromSession([{ modelId: "  " }, { name: "missing" }])).toBeNull();
    expect(() => clineTurnModel("other-model", "saved", clineFallbackCatalog())).toThrow(/Cline default/);
    expect(clineTurnModel("cline-default", "saved", clineFallbackCatalog())).toBe("saved");
    expect(clineTurnModel(undefined, "saved", clineFallbackCatalog())).toBe("saved");
  });

  it("caches the session list and allows only those ids", () => {
    const catalog = clineCatalogFromSession([
      { modelId: "provider/fast", name: "Fast" },
      { modelId: "provider/fast", name: "duplicate" },
      { modelId: "cline-default", name: "ignored" },
      { modelId: "bad id", name: "spaces" },
    ]);
    expect(catalog?.options).toEqual([
      { id: "cline-default", label: "Cline default (configured)" },
      { id: "provider/fast", label: "Fast" },
    ]);
    expect(clineTurnModel("provider/fast", undefined, catalog!)).toBe("provider/fast");
    expect(() => clineTurnModel("provider/other", undefined, catalog!)).toThrow(/Cline default/);
  });
});
