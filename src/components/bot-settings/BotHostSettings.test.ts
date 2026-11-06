import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BotHostForm, type PublishedComputer } from "./BotHostSettings";

const laptop: PublishedComputer = {
  deviceId: "laptop",
  name: "Studio",
  online: true,
  engines: [{ instanceId: "pi", label: "pi", models: [{ id: "qwen", label: "Qwen" }, { id: "other", label: "Other" }] }],
};

describe("where a bot runs", () => {
  it("offers the organization server and this computer's models", () => {
    const markup = renderToStaticMarkup(createElement(BotHostForm, {
      host: { kind: "machine", userId: "pr_morgan", deviceId: "laptop" },
      workers: [laptop],
      canEdit: true,
      model: { instanceId: "pi", model: "qwen" },
      onFleet: () => undefined,
      onMachine: () => undefined,
      onModel: () => undefined,
    }));
    expect(markup).toContain("Where this bot runs");
    expect(markup).toContain("while this computer is on");
    expect(markup).toContain("This computer (Studio)");
    expect(markup).toContain('data-bot-host="fleet"');
    expect(markup).toContain('data-bot-host="laptop"');
    expect(markup).toContain("pi · Qwen");
    // The other models sit in the PillSelect list, rendered when it opens.
    expect(markup).toContain('aria-label="Models on this computer"');
    expect(markup).not.toContain("pr_morgan");
  });

  it("does not list a computer that was not handed to this person", () => {
    const markup = renderToStaticMarkup(createElement(BotHostForm, {
      host: { kind: "fleet" },
      workers: [],
      canEdit: false,
      onFleet: () => undefined,
      onMachine: () => undefined,
      onModel: () => undefined,
    }));
    expect(markup).toContain("Organization server");
    // the organization server answers while the person's computer is off (#1542)
    expect(markup).toContain("it answers even when your computer is off");
    expect(markup).not.toContain("while this computer is on");
    expect(markup).not.toContain("data-bot-host=\"studio\"");
    expect(markup).toContain("disabled");
  });
});
