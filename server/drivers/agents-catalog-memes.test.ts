// send_meme (#2121): shown when meme replies are on; hidden when off or on a call.
import { describe, expect, it } from "vitest";

import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";

function names(env: NodeJS.ProcessEnv): string[] {
  return availableTools(catalogProfileFromEnv(env)).map((tool) => tool.name);
}

describe("send_meme in the catalog", () => {
  it("is offered by default and when SAGAX_MEME_REPLIES is 1", () => {
    expect(names({})).toContain("send_meme");
    expect(names({ SAGAX_MEME_REPLIES: "1" })).toContain("send_meme");
  });

  it("is hidden when meme replies are off or the turn is a live call", () => {
    expect(names({ SAGAX_MEME_REPLIES: "0" })).not.toContain("send_meme");
    expect(names({ SAGAX_VOICE_CALL: "1" })).not.toContain("send_meme");
  });
});
