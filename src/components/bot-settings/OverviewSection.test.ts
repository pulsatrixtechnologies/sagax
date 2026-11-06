import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BotOverview } from "@/lib/bot-overview-types";
import type { PromptPreviewData } from "./PromptPreview";
import { OverviewSection } from "./OverviewSection";
import { PromptPreview } from "./PromptPreview";
import { SettingsSurfaceProvider } from "../SettingsPrimitives";

// renderToStaticMarkup HTML-escapes apostrophes as &#x27; — decode before
// comparing against plain-text fixtures that use a straight quote.
function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element).replace(/&#x27;/g, "'");
}

// A bot with every off switch flipped: exercises all six "wont" sentences
// buildBotOverview (server/bots/bot-overview.ts) can produce at once.
const sentences: BotOverview = {
  who: {
    name: "Scout",
    title: "Research specialist",
    blurb: "Digs into a claim and reports back with sources.",
    soulLead: "Always cite primary sources and separate fact from inference.",
  },
  does: ["Daily at 9:00 AM: Morning brief. Next run 9:00 AM."],
  reaches: ["Works in its private workspace.", "Has the built-in browser."],
  wont: [
    "Won't run commands without asking you first.",
    "Won't contact other bots without asking.",
    "Has no connected apps.",
    "Can't use a computer.",
    "Won't act on a schedule.",
    "Won't change its own instructions without your approval.",
  ],
  recent: [{ at: 1700000000000, summary: "Title changed" }],
};

const prompt: PromptPreviewData = {
  sections: [{ id: "persona", label: "Identity", text: "You are Scout.", bytes: 42 }],
  totalBytes: 42,
  approxTokens: 11,
  note: "Approximate.",
};

describe("OverviewSection", () => {
  it("does not offer setup ideas", () => {
    const markup = render(createElement(OverviewSection, {
      overview: { ...sentences, setup: [
        { id: "identity", label: "Identity", done: true, section: "details" },
        { id: "folder", label: "Choose a project folder", done: false, section: "access" },
        { id: "schedule", label: "Add a routine", done: false, section: "routines" },
      ] }, prompt: null, onOpen: vi.fn(),
    }));
    expect(markup).not.toContain("Setup ideas");
    expect(markup).not.toContain("Set up with the bot");
    expect(markup).not.toContain("Choose a project folder");
    expect(markup).not.toContain("Add a routine");
  });

  it("shows Loading… before the overview arrives", () => {
    const markup = render(
      createElement(OverviewSection, { overview: null, prompt: null, onOpen: vi.fn() }),
    );
    expect(markup).toContain("Loading…");
  });

  it("renders the six wont lines, a does line, and a Read all link into Soul", () => {
    const markup = render(
      createElement(OverviewSection, { overview: sentences, prompt, onOpen: vi.fn() }),
    );

    for (const line of sentences.wont) {
      expect(markup).toContain(line);
    }
    expect(markup).toContain(sentences.does[0]);
    expect(markup).toContain("Read all");
  });

  it("shows the empty-does fallback when the bot does nothing yet", () => {
    const empty: BotOverview = { ...sentences, does: [] };
    const markup = render(
      createElement(OverviewSection, { overview: empty, prompt, onOpen: vi.fn() }),
    );

    expect(markup).toContain("Nothing scheduled or learned yet.");
  });

  it("passes promptError through to PromptPreview instead of just nulling the data", () => {
    const markup = render(
      createElement(OverviewSection, { overview: sentences, prompt: null, promptError: true, onOpen: vi.fn() }),
    );

    // Closed by default, so the failure text isn't shown yet — but the
    // header must not be stuck offering a preview that will never arrive.
    expect(markup).toContain("Prompt preview");
  });

  it("keeps showing the loaded overview and adds a quiet banner when a background refresh fails", () => {
    const markup = render(
      createElement(OverviewSection, { overview: sentences, refreshError: true, prompt, onOpen: vi.fn() }),
    );

    expect(markup).toContain("Couldn’t refresh. Showing the last loaded overview.");
    // The data itself must still be there — a refresh failure is not a load
    // failure, so none of the sections should be replaced by an error state.
    for (const line of sentences.wont) {
      expect(markup).toContain(line);
    }
  });

  it("omits the refresh banner when there was no refresh error", () => {
    const markup = render(
      createElement(OverviewSection, { overview: sentences, refreshError: false, prompt, onOpen: vi.fn() }),
    );

    expect(markup).not.toContain("Couldn’t refresh");
  });

  it("no longer lists the recent changes (the History tab holds them)", () => {
    const markup = render(createElement(OverviewSection, { overview: sentences, prompt, onOpen: vi.fn() }));
    expect(markup).not.toContain("Recent changes");
    expect(markup).not.toContain("Title changed");
    expect(markup).not.toContain("overviewRecent");
  });
});

// The bot profile page draws "What it does" with the profile's card look.
const BORDER = /\bborder(-\[|-border|-hairline|-accent)/;
function plain(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return render(createElement(SettingsSurfaceProvider, { surface: "plain", children: element }));
}

describe("OverviewSection on the bot profile (plain surface)", () => {
  it("puts who the bot is, Read all and the prompt preview in one card labelled What it does", () => {
    const markup = plain(createElement(OverviewSection, { overview: sentences, prompt, onOpen: vi.fn() }));
    expect(markup).toContain('data-settings-group="overviewSummary"');
    expect(markup).toContain(">What it does</h3>");
    expect(markup).toContain(sentences.who.blurb);
    expect(markup).toContain(sentences.who.soulLead);
    expect(markup).toContain('data-link-row="readSoul"');
    expect(markup).toContain("Read all");
    expect(markup).toContain("Prompt preview");
    expect(markup).toContain("42 bytes ≈ 11 tokens");
    expect(markup).toContain('data-prompt-preview="closed"');
  });

  it("keeps Does, Can reach and Won't as labelled cards, one sentence per row", () => {
    const markup = plain(createElement(OverviewSection, { overview: sentences, prompt, onOpen: vi.fn() }));
    for (const label of [">Does</h3>", ">Can reach</h3>", ">Won't</h3>"]) {
      expect(markup).toContain(label);
    }
    for (const line of [...sentences.does, ...sentences.reaches, ...sentences.wont]) expect(markup).toContain(line);
  });

  it("draws no border, no underline, no primary button and no recent changes", () => {
    const markup = plain(createElement(OverviewSection, { overview: sentences, refreshError: true, prompt, onOpen: vi.fn() }));
    expect(markup).not.toMatch(BORDER);
    expect(markup).not.toContain("underline");
    expect(markup).not.toContain("ui-button-primary");
    expect(markup).not.toContain("font-medium");
    expect(markup).not.toContain("Recent changes");
    expect(markup).not.toContain("Title changed");
    expect(markup).toContain("Couldn’t refresh. Showing the last loaded overview.");
  });

  it("shows Loading… inside the labelled card before the overview arrives", () => {
    const markup = plain(createElement(OverviewSection, { overview: null, prompt: null, onOpen: vi.fn() }));
    expect(markup).toContain(">What it does</h3>");
    expect(markup).toContain("Loading…");
  });

  it("unfolds the prompt as rows whose text sits in a filled box without outline", () => {
    const markup = plain(createElement(PromptPreview, { data: prompt, open: true, onToggle: vi.fn() }));
    expect(markup).toContain('data-prompt-preview="open"');
    expect(markup).toContain("Identity");
    expect(markup).toContain("42 bytes");
    expect(markup).toContain("rounded-lg bg-inset");
    expect(markup).toContain("Approximate.");
    expect(markup).not.toMatch(BORDER);
    expect(markup).not.toContain("font-medium");
    const closed = plain(createElement(PromptPreview, { data: prompt, open: false, onToggle: vi.fn() }));
    expect(closed).not.toContain("Identity");
    const failed = plain(createElement(PromptPreview, { data: null, error: true, open: true, onToggle: vi.fn() }));
    expect(failed).toContain("Couldn’t load the prompt preview.");
  });
});
