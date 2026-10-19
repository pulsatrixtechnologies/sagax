import { describe, expect, it } from "vitest";

import { chiefOfStaffSystemPrompt } from "./chief-of-staff.ts";

describe("chiefOfStaffSystemPrompt roster caps", () => {
  it("clips oversized persona fields instead of interpolating them whole", () => {
    const prompt = chiefOfStaffSystemPrompt(
      "chief",
      [
        { id: "chief", name: "Atlas" },
        {
          id: "big",
          name: "N".repeat(500),
          title: "T".repeat(500),
          description: "D".repeat(10_000),
        },
      ],
      true,
    );
    // an imported 10KB description must not ride into the Chief's system
    // prompt — the roster line stays bounded
    const rosterLine = prompt.split("\n").find((line) => line.startsWith("- N"))!;
    expect(rosterLine.length).toBeLessThan(500);
    expect(rosterLine).toContain("…");
  });

  it("caps the roster length and says how many were left out", () => {
    const team = Array.from({ length: 60 }, (_, i) => ({ id: `bot${i}`, name: `Bot ${i}` }));
    const prompt = chiefOfStaffSystemPrompt("chief", [{ id: "chief", name: "Atlas" }, ...team], true);
    expect(prompt).toContain("Bot 39");
    expect(prompt).not.toContain("Bot 40 —");
    expect(prompt).toContain("…and 20 more");
  });
});

describe("chiefOfStaffSystemPrompt", () => {
  const bots = [
    { id: "chief", name: "Atlas", title: "Operations", section: "Work" },
    { id: "writer", name: "Quill", title: "Writer", description: "Drafts concise copy", section: "Work" },
    { id: "coder", name: "Patch", title: "Engineer", busy: true, section: "Work" },
    { id: "hidden", name: "Secret", hidden: true, section: "Work" },
    { id: "personal", name: "Scout", title: "Travel planner", section: "Personal" },
  ];

  it("describes visible teammates and roles, but not who is busy", () => {
    const prompt = chiefOfStaffSystemPrompt("chief", bots, true);

    expect(prompt).toContain("Your home team is the Work section");
    expect(prompt).toContain("Quill — Writer: Drafts concise copy [id: writer]");
    expect(prompt).toContain("Patch — Engineer [id: coder]");
    // availability changes turn to turn; it rides the volatile half instead
    expect(prompt).not.toContain("working right now");
    expect(prompt).not.toContain("(available)");
    expect(prompt).not.toContain("Secret");
    expect(prompt).not.toContain("Scout");
    expect(prompt).not.toContain("Atlas —");
    expect(prompt).toContain("Use coordinate_bots to assign actual teammates concrete work");
    expect(prompt).toContain("keeps you available to the user");
    expect(prompt).toContain("you resume automatically when their results return, success or failure");
    expect(prompt).toContain("Do not poll or wait");
    expect(prompt).toContain("with consult: true to ask them for advice");
    expect(prompt).toContain("Consultations are advice, not proof that work or tests ran");
    // one surface: the legacy tool names are not what a Chief is taught
    expect(prompt).not.toMatch(/\b(delegate_bot|ask_bot|send_to_bot|check_delegation|wait_delegation)\b/);
    expect(prompt).toContain("propose_team_setup once");
    expect(prompt).toContain("structured result");
  });

  it("does not promise delegation when the engine cannot mount agent tools", () => {
    const prompt = chiefOfStaffSystemPrompt("chief", bots, false);

    expect(prompt).toContain("cannot contact teammates");
    expect(prompt).not.toContain("coordinate_bots");
  });

  it("follows staffing result states", () => {
    const prompt = chiefOfStaffSystemPrompt("chief", bots, true);
    expect(prompt).toContain("after an applied result, continue already-requested work without another confirmation");
    expect(prompt).toContain("Only if review is pending, end your turn");
    expect(prompt).toContain("Report failed or cancelled results honestly");
    expect(prompt).toContain("Existing thread models and other bots' execution permissions stay unchanged");
    expect(prompt).toContain("For explicitly requested bot deletion");
    expect(prompt).not.toContain("End your turn after the proposal:");
  });

  it("pins the one coordination guidance and the shared staffing text", () => {
    const prompt = chiefOfStaffSystemPrompt("chief", bots, true);

    expect(prompt).toBe(
      [
        "You are the user's Primary Bot: their main contact among their bots, who coordinates the others. Your home team is the Work section.",
        "Own the outcome: understand the request, decide what to handle yourself, coordinate the right specialists when useful, and return one concise consolidated answer.",
        "Do not delegate trivial work merely to appear busy. Never invent a teammate's progress or result. Normal permission and approval rules still apply.",
        "Incidents: when a teammate's run fails, stalls or cannot start, Sagax reports it to you in your \"Team incidents\" thread with a link to the thread. Read the report, then either call retry_thread to resume that thread where it stopped, coordinate_bots with a corrected brief when the request itself must change, or — when only the person can fix the cause (a sign-in, a missing credential, an unanswered question, a setting) — say so plainly and stop. Never retry the same thread more than twice; report what failed and what you did in one or two sentences.",
        "Use list_bots or list_room_targets for the live reachable roster. Use coordinate_bots to assign actual teammates concrete work, or with consult: true to ask them for advice. It returns immediately and keeps you available to the user; give clear, self-contained briefs, then end your turn — you resume automatically when their results return, success or failure. Say that work is assigned, not completed; only claim completion after the teammate's result has actually arrived, and if a teammate fails or stalls, tell the user plainly and decide the next step yourself. Leads can coordinate their own specialists. Do not poll or wait, send acknowledgements as new work, or substitute native helpers for named bots. On return, verify the requested outcome, resolve decisions within the user's scope, request concrete corrections with rework=true when necessary, and return one consolidated answer. Consultations are advice, not proof that work or tests ran. A refusal from coordinate_bots means nothing was sent: fix what it names (usually the id — copy it from list_bots or your roster; a unique teammate name also works) and retry, and never describe a handoff the tool did not accept.",
        "When the user asks you to assemble or configure a team, use list_team_setup for the exact authorized teams, bot IDs and model catalog, then propose_team_setup once with all named specialists and their profile/model changes. Include new teams explicitly; the plan covers their creation and your access. Existing thread models and other bots' execution permissions stay unchanged. Follow the tool result: granted Full Access may apply the plan immediately; after an applied result, continue already-requested work without another confirmation. Only if review is pending, end your turn: the user's decision automatically resumes you once with a structured result. Report failed or cancelled results honestly. Do not ask for another yes, poll, or repeat the proposal. After successful setup, use the available coordination tools for already requested work. Use create_bot only for a single specialist when no combined setup was requested. For explicitly requested bot deletion, use propose_bot_deletion separately and follow its applied or pending result too. Do not create duplicate or unnecessary bots.",
        "If the requested work clearly needs a specialist your team lacks and the user did not ask for one, you may suggest it with create_bot and suggestion: true. Keep at most one suggestion open in a conversation. If the user chooses Not now, do not suggest another specialist in that conversation unless they ask.",
        "Current Work section team:",
        "- Quill — Writer: Drafts concise copy [id: writer]",
        "- Patch — Engineer [id: coder]",
      ].join("\n"),
    );
  });

  it("narrows the Chief's own roster when the Chief carries an allow-list", () => {
    // The roster and the comms endpoints read the same rule, so a Chief is
    // never told about a teammate its own coordinate_bots would then be refused.
    const prompt = chiefOfStaffSystemPrompt(
      "chief",
      bots.map((bot) => (bot.id === "chief" ? { ...bot, peers: ["coder"] } : bot)),
      true,
    );

    expect(prompt).toContain("Patch — Engineer [id: coder]");
    expect(prompt).not.toContain("Quill");
  });
});
