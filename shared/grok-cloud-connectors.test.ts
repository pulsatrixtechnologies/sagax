import { describe, expect, it } from "vitest";

import { GROK_CLOUD_CONNECTORS } from "./grok-cloud-connectors.ts";

describe("Grok cloud connectors", () => {
  it("names Exchange, X and Microsoft Teams for the Connect apps list", () => {
    const names = GROK_CLOUD_CONNECTORS.map((connector) => connector.name);
    expect(names).toEqual(expect.arrayContaining(["Outlook (Exchange)", "X", "Microsoft Teams"]));
    expect(new Set(GROK_CLOUD_CONNECTORS.map((connector) => connector.id)).size).toBe(GROK_CLOUD_CONNECTORS.length);
  });
});
