import { describe, expect, it } from "vitest";

import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";

const names = (env: Record<string, string>) => availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "b1", ...env })).map((tool) => tool.name);

describe("agents catalog: join_meeting (experimental meeting notetaker)", () => {
  it("is absent while Settings > Developer > Experimental > Meeting notetaker is off (the default)", () => {
    expect(names({})).not.toContain("join_meeting");
    expect(names({ SAGAX_MEETINGS: "0" })).not.toContain("join_meeting");
  });

  it("is offered when the harness turns it on, never to an external runtime", () => {
    expect(names({ SAGAX_MEETINGS: "1" })).toContain("join_meeting");
    expect(names({ SAGAX_MEETINGS: "1", SAGAX_EXTERNAL_RUNTIME: "1" })).not.toContain("join_meeting");
  });
});
