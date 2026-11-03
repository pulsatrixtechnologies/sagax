import { describe, expect, it } from "vitest";

import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";
import { isReadOnlyAgentTool } from "../tools/agent-tool-policy.ts";

const names = (env: Record<string, string>) => availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "b1", ...env })).map((tool) => tool.name);

describe("agents catalog: recall_topic (single stream, thread mode off)", () => {
  it("is absent from a thread-mode turn, so its catalog is unchanged", () => {
    expect(names({})).not.toContain("recall_topic");
    expect(names({ SAGAX_SINGLE_STREAM: "0" })).not.toContain("recall_topic");
  });

  it("is offered in a person's stream turn, never to an external runtime, and is a read", () => {
    expect(names({ SAGAX_SINGLE_STREAM: "1" })).toContain("recall_topic");
    expect(names({ SAGAX_SINGLE_STREAM: "1", SAGAX_EXTERNAL_RUNTIME: "1" })).not.toContain("recall_topic");
    expect(isReadOnlyAgentTool("recall_topic")).toBe(true);
  });
});
