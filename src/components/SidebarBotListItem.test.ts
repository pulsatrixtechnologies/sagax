import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, type Bot } from "@/state/store";

vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({}),
}));

vi.mock("@/lib/thread-preferences", () => ({
  useShowThreads: () => true,
  useThreadsLocationChoice: () => "header",
}));

import { ConfirmDialogCard } from "./ConfirmDialog";
import { BotDeleteMenuItem, BotListItem, botConfirmCopy, currentArchivableBot } from "./Sidebar";
import { endCall } from "@/lib/call";

const bot = (overrides: Partial<Bot> = {}): Bot => ({
  id: "atlas",
  threadId: "thread-atlas",
  name: "Atlas",
  title: "",
  description: "",
  notifications: true,
  color: "green",
  unread: false,
  modelSelection: { instanceId: "claude", model: "test" },
  messages: [],
  ...overrides,
});

function renderRow(candidate: Bot, quiet = false, density: "comfortable" | "icons" = "comfortable") {
  return renderToStaticMarkup(createElement(
    StoreProvider,
    null,
    createElement(BotListItem, {
      bot: candidate,
      density,
      quiet,
      onMenu: vi.fn(),
    }),
  ));
}

afterEach(() => {
  endCall();
  vi.unstubAllGlobals();
});

describe("BotListItem", () => {
  it("keeps a routine run out of the row: the mascot dot stays, the status line does not say working", () => {
    const run = bot({ busy: true, tasks: [{ threadId: "thread-atlas", title: "Run", createdAt: 1, routineRunId: "run-1", busy: true }] });
    const markup = renderRow(run);
    expect(markup).toContain('data-testid="working-dot"');
    expect(markup).not.toContain("Working");
    // an ordinary working conversation still shows its typing dots and text
    const normal = renderRow(bot({ busy: true, tasks: [{ threadId: "thread-atlas", title: "Chat", createdAt: 1, busy: true }] }));
    expect(normal).toContain("Working");
  });

  it("has a New thread button beside a keyboard-accessible bot menu, and no New folder", () => {
    const markup = renderRow(bot());
    // New thread is back on the row (JC, 2026-10-15)
    expect(markup).toContain('aria-label="New thread"');
    expect(markup).toContain('data-sidebar-bot-new-thread="atlas"');
    expect(markup).not.toContain("New folder");
    expect(markup).not.toContain("5.75rem");
    expect(markup).toContain('aria-label="Actions for Atlas"');
    expect(markup).toContain('aria-haspopup="menu"');
  });
  const twoThreads = (): Partial<Bot> => ({
    tasks: [{ threadId: "thread-atlas", title: "Current", createdAt: 2 }, { threadId: "thread-earlier", title: "Earlier", createdAt: 1 }],
  });

  // Threads on: nothing under the bot, so no disclosure to fold it either
  // (JC, 2026-10-08). The chat header's picker lists the threads.
  it("draws no thread toggle and no thread rows, whatever the bot holds", () => {
    for (const candidate of [bot(), bot(twoThreads()), bot({ projects: [{ id: "p1", name: "Research" }] })]) {
      const markup = renderRow(candidate);
      expect(markup).toContain('role="button" tabindex="0"');
      expect(markup).not.toContain("Atlas threads");
      expect(markup).not.toContain("aria-expanded");
      expect(markup).not.toContain("data-sidebar-thread-row=");
      expect(markup).not.toContain("data-sidebar-folder-row=");
    }
  });

  // Phase 0 writes a digest row after every turn, so the last row of an idle
  // chat is now a receipt; the preview must still be the reply a person reads.
  it("previews the last reply, not the digest receipt that follows it", () => {
    const markup = renderRow(bot({
      messages: [
        { id: "u1", role: "user", kind: "text", text: "make notes.txt", at: 1 },
        { id: "b1", role: "bot", kind: "text", text: "Created notes.txt with three lines.", at: 2 },
        { id: "d1", role: "bot", kind: "digest", text: "[digest] · tools: Write ×1", at: 3, digest: { turnId: "t1", tools: [{ name: "Write", count: 1 }], hookCoverage: "full" } },
      ] as Bot["messages"],
    }));
    expect(markup).toContain("Created notes.txt with three lines.");
    expect(markup).not.toContain("[digest]");
  });

  // Hanging up appends the call's record as the chat's last row. Like the
  // digest receipt, it is not what the row says about the chat.
  describe("the record of a live call that ended last", () => {
    const at = (minute: number) => new Date(2026, 9, 6, 10, minute).getTime();
    const record = {
      id: "r1", role: "bot", kind: "call", at: at(2), text: "Call with Atlas · 1:42",
      call: { callId: "c1", botId: "atlas", client: "ios", startedAt: at(0), endedAt: at(2), seconds: 102, endReason: "hung-up" },
    };
    const spoken = { id: "u1", role: "user", kind: "text", text: "what is the weather", at: at(0), via: "call", callId: "c1" };
    const draw = (candidate: Bot) => renderRow(candidate);

    it("previews the last reply, not the record that follows it", () => {
      const markup = draw(bot({
        messages: [spoken, { id: "b1", role: "bot", kind: "text", text: "Sunny in Pune.", at: at(1) }, record] as Bot["messages"],
      }));
      expect(markup).toContain("Sunny in Pune.");
      expect(markup).not.toContain("Call with Atlas");
    });

    it("previews a failed turn's row when the record follows it", () => {
      const markup = draw(bot({
        messages: [spoken, { id: "e1", role: "bot", kind: "activity", at: at(1), tool: { name: "error: This computer isn't a place on your OMB Cloud: its bots run in the cloud.", ok: false } }, record] as Bot["messages"],
      }));
      expect(markup).toContain("This computer isn&#x27;t a place on your OMB Cloud: its bots run in the cloud.");
      expect(markup).not.toContain("Call with Atlas");
    });
    // Upstream also times the open row and names the running step from a
    // searched thread list; this row reads its selection from the store and
    // lists no threads under the bot (header mode), so those stay out here.
  });

  // A failed turn's row is stored as "error: …"; the preview reads like the
  // chat row (src/lib/failed-turn.ts), not like a log line.
  it("previews a failed turn without its error marker", () => {
    const markup = renderRow(bot({
      messages: [
        { id: "u1", role: "user", kind: "text", text: "check the site", at: 1 },
        { id: "e1", role: "bot", kind: "activity", at: 2, tool: { name: "error: This computer isn't a place on your OMB Cloud: its bots run in the cloud.", ok: false } },
      ] as Bot["messages"],
    }));
    expect(markup).toContain("This computer isn&#x27;t a place on your OMB Cloud: its bots run in the cloud.");
    expect(markup).not.toContain("error:");
  });

  // A turn can end on the approval card itself: Stop while it is open, or a
  // provider that settles the ask without writing more. The card then reads
  // Allowed or Denied, and the row must say the same, not "Approval needed".
  describe("an approval card that ends the chat", () => {
    const approval = (card: Partial<NonNullable<Bot["messages"][number]["card"]>>): Bot => bot({
      messages: [
        { id: "u1", role: "user", kind: "text", text: "list the files", at: 1 },
        {
          id: "c1", role: "bot", kind: "options", at: 2,
          card: { title: "Approval needed", subtitle: "ls -la", options: ["Allow", "Deny"], requestId: "r1", tool: "Bash", ...card },
        },
      ] as Bot["messages"],
    });

    it("keeps the request's title while it is still open", () => {
      expect(renderRow(approval({}))).toContain("Approval needed");
    });

    it("says Allowed once it was allowed", () => {
      const markup = renderRow(approval({ answered: "allow" }));
      expect(markup).toContain("Allowed");
      expect(markup).not.toContain("Approval needed");
    });

    it("says Denied once it was denied, or closed by Stop", () => {
      for (const answered of ["deny", "unavailable"]) {
        const markup = renderRow(approval({ answered, dismissed: answered === "unavailable" }));
        expect(markup).toContain("Denied");
        expect(markup).not.toContain("Approval needed");
      }
    });

    it("says Expired once nothing can answer it", () => {
      const markup = renderRow(approval({ expired: true, options: [] }));
      expect(markup).toContain("Expired");
      expect(markup).not.toContain("Approval needed");
    });
  });

  it("leaves the full Chief card as one selectable hit area", () => {
    const markup = renderRow(bot({ chiefOfStaff: true }));

    expect(markup).toContain('data-sidebar-bot-row="atlas"');
    expect(markup).not.toContain('aria-label="Archive Atlas"');
  });

  it("marks the Primary Bot with the orange star on its avatar, never a label chip or crown", () => {
    const withTitle = renderRow(bot({ chiefOfStaff: true, title: "Developer" }));
    expect(withTitle).toContain('data-testid="primary-bot-badge"');
    expect(withTitle).toContain('aria-label="Primary Bot"');
    expect(withTitle).not.toContain("Primary Bot</span>");
    expect(withTitle).not.toContain("lucide-crown");
    // The star sits on the avatar, before the name.
    expect(withTitle.indexOf('data-testid="primary-bot-badge"')).toBeLessThan(withTitle.indexOf(">Atlas<"));

    expect(renderRow(bot())).not.toContain("primary-bot-badge");
    // Someone else's Primary Bot shared with the viewer wears no star.
    expect(renderRow(bot({ chiefOfStaff: true, ownerUserId: "someone-else" }))).not.toContain("primary-bot-badge");
  });

  it("moves a status dot to the top-right while the star holds the bottom-right", () => {
    const working = renderRow(bot({ chiefOfStaff: true, busy: true }));
    expect(working).toMatch(/data-testid="working-dot" class="[^"]*-top-0\.5/);
    expect(renderRow(bot({ busy: true }))).toMatch(/data-testid="working-dot" class="[^"]*-bottom-0\.5/);
  });


  // Grok Bot's row (JC, 2026-10-15): the role (Bot settings > Title) is a
  // pill right after the name, in the same line.
  it("draws the role as a pill right after the name", () => {
    const markup = renderRow(bot({ title: "ConnectWise Ops & MS 365" }));
    const pill = markup.match(/<span data-bot-role-tag=""[^>]*>[\s\S]*?<\/span><\/span>/)?.[0] ?? "";
    expect(pill).toContain(">ConnectWise Ops &amp; MS 365<");
    for (const token of ["rounded-[4px]", "border-[0.5px]", "text-[11px]", "leading-4", "px-1", "py-px", "basis-[2em]", "max-w-fit", "text-sidebar-ink-secondary"]) {
      expect(pill.split(/[\s"]/)).toContain(token);
    }
    expect(markup.indexOf("data-bot-role-tag")).toBeGreaterThan(markup.indexOf(">Atlas<"));
    expect(markup).toContain('title="Atlas · ConnectWise Ops &amp; MS 365"');
    expect(renderRow(bot())).not.toContain("data-bot-role-tag");
    expect(renderRow(bot({ title: "  " }))).not.toContain("data-bot-role-tag");
  });

  it("lets the name give way before the role pill shrinks under 2em", () => {
    const longTitle = "Meta-Agent, opensource team maintainer";
    const markup = renderRow(bot({ name: "Team Maintainer", title: longTitle }));
    expect(markup).toContain(">Team Maintainer<");
    expect(markup).toContain(`>${longTitle}<`);
    expect(markup).toMatch(/class="flex min-w-0 shrink items-center gap-1 text-\[14px\] font-medium leading-5 text-sidebar-ink"/);
  });

  it("previews the last reply as plain text, without its markdown", () => {
    const markup = renderRow(bot({
      messages: [{ id: "b1", role: "bot", kind: "text", text: "I read **[Prudctual/Sagax](https://github.com/Prudctual/Sagax)**. Run `pnpm install` first.", at: 1 }] as Bot["messages"],
    }));
    expect(markup).toContain(">I read Prudctual/Sagax. Run pnpm install first.<");
    expect(markup).not.toContain("**");
    expect(markup).not.toContain("](https://");
  });

  it("shows typing dots instead of preview text while the bot works", () => {
    const markup = renderRow(bot({ busy: true }));

    expect(markup).toContain("animate-status-pulse");
    expect(markup).toContain('class="sr-only">Working…');
  });

  it("marks the avatar with a green presence dot only while the bot works", () => {
    expect(renderRow(bot({ busy: true }))).toContain('data-testid="working-dot"');
    expect(renderRow(bot())).not.toContain('data-testid="working-dot"');
    expect(renderRow(bot({ busy: true, activity: "waiting-on-you" }))).not.toContain('data-testid="working-dot"');
  });

  it("marks an idle bot waiting on a teammate with a quiet dot, never the work signals", () => {
    const markup = renderRow(bot({ waitingForTeammates: true, busy: false, activity: "idle" }));
    expect(markup).toContain('data-testid="teammate-wait-dot"');
    expect(markup).not.toContain('data-testid="working-dot"');
    expect(markup).not.toContain("animate-status-pulse");
    expect(markup).toContain("Waiting on a teammate…");
  });

  it("keeps real sibling work visible while another thread waits for a teammate", () => {
    const markup = renderRow(bot({ waitingForTeammates: true, busy: true, activity: "working" }));
    expect(markup).toContain('data-testid="working-dot"');
    expect(markup).not.toContain('data-testid="teammate-wait-dot"');
  });

  it("keeps Archive in the Actions menu and reveals quiet row controls on focus as well as hover", () => {
    const markup = renderRow(bot());
    expect(markup).not.toContain('aria-label="Archive Atlas"');
    expect(markup).toContain('aria-label="Actions for Atlas"');
    expect(markup).toContain("group-focus-within:opacity-100");
    expect(markup).toContain("group-hover:pointer-events-auto");
    expect(markup).not.toContain("pr-[92px]");
  });
});

describe("archive / delete confirmation", () => {
  it("rechecks the latest fleet after a confirmation was opened", () => {
    const snapshot = bot();
    const other = bot({ id: "other" });
    const renamed = bot({ name: "New name" });
    expect(currentArchivableBot([renamed, other], snapshot.id)).toBe(renamed);
    expect(currentArchivableBot([bot({ chiefOfStaff: true }), other], snapshot.id)).toBeUndefined();
    expect(currentArchivableBot([bot({ hidden: true }), other], snapshot.id)).toBeUndefined();
    expect(currentArchivableBot([snapshot], snapshot.id)).toBeUndefined();
    expect(currentArchivableBot([other, bot({ id: "third" })], snapshot.id)).toBeUndefined();
  });
  it("archive copy names the bot and says it can be restored", () => {
    const copy = botConfirmCopy("archive", "Juniper");

    expect(copy.title).toContain("Juniper");
    expect(copy.body).toMatch(/restore/i);
    expect(copy.tone).toBe("neutral");
  });

  it("delete copy names the bot and warns about its owned computer", () => {
    const copy = botConfirmCopy("delete", "Willow");

    expect(copy.title).toContain("Willow");
    expect(copy.body).toMatch(/permanently/i);
    expect(copy.body).toMatch(/any computer it owns/i);
    expect(copy.body).toMatch(/files and browser sign-ins/i);
    expect(copy.body).toMatch(/shared team computers remain/i);
    expect(copy.tone).toBe("danger");
  });

  it("renders as an alert dialog with Cancel and the action button", () => {
    const markup = renderToStaticMarkup(createElement(ConfirmDialogCard, {
      open: true,
      ...botConfirmCopy("delete", "Willow"),
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
    }));

    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain("Delete Willow?");
    expect(markup).toContain(">Cancel</button>");
    expect(markup).toContain(">Delete</button>");
    expect(markup).toContain("bg-danger");
  });
});

describe("bot deletion feedback", () => {
  it("disables the destructive action while the bot and its computer are deleted", () => {
    const markup = renderToStaticMarkup(createElement(BotDeleteMenuItem, {
      deleting: true,
      onClick: vi.fn(),
    }));

    expect(markup).toContain("Deleting bot and owned computer…");
    expect(markup).toContain('title="Deleting this bot and any computer it owns"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-busy="true"');
  });

  it("offers Delete again after the check settles", () => {
    const markup = renderToStaticMarkup(createElement(BotDeleteMenuItem, {
      deleting: false,
      onClick: vi.fn(),
    }));

    expect(markup).toContain(">Delete</button>");
    expect(markup).not.toContain('disabled=""');
  });

  describe("quiet rows", () => {
    const titlePill = /<span class="max-w-\[46%\] shrink truncate[^"]*">([^<]*)<\/span>/;

    it("reduces an idle bot to its name: no title pill, no Chief line, no preview", () => {
      const markup = renderRow(bot({
        title: "Developer",
        chiefOfStaff: true,
        messages: [{ id: "b1", role: "bot", kind: "text", text: "Created notes.txt with three lines.", at: 2 }] as Bot["messages"],
      }), true);
      expect(titlePill.test(markup)).toBe(false);
      expect(markup).not.toContain("Chief of Staff</span>");
      expect(markup).not.toContain("Created notes.txt with three lines.");
      expect(markup).toContain(">Atlas<");
      // the star stays on the avatar, with its label for assistive tech
      expect(markup).toContain('data-testid="primary-bot-badge"');
      expect(markup).toContain('aria-label="Primary Bot"');
    });

    it("keeps the status line while something is happening", () => {
      expect(renderRow(bot({ busy: true }), true)).toContain('class="sr-only">Working…');
      expect(renderRow(bot({ activity: "waiting-on-you" }), true)).toContain("Waiting for you…");
      expect(renderRow(bot({ waitingForTeammates: true, busy: false }), true)).toContain("Waiting on a teammate…");
    });

    it("renders no dot at all for an idle bot row", () => {
      for (const quiet of [false, true]) {
        const markup = renderRow(bot(), quiet);
        expect(markup).not.toContain("rounded-full");
        expect(markup).not.toContain("-dot");
        expect(markup).not.toMatch(/sr-only[^>]*>Unread threads</);
      }
    });

    it("keeps a coloured dot for working, waiting and unread", () => {
      expect(renderRow(bot({ busy: true }))).toContain('data-testid="working-dot"');
      expect(renderRow(bot({ activity: "waiting-on-you" }))).toContain('data-testid="waiting-dot"');
      const unread = renderRow(bot({ unread: true }));
      // Grok Bot's unread: the name keeps its weight, a blue dot sits at the
      // row's end, and the screen-reader label stays.
      expect(unread).toMatch(/sr-only[^>]*>Unread threads</);
      expect(unread).not.toContain("font-semibold");
      expect(unread).toContain("data-sidebar-unread-dot");
      expect(unread).not.toContain("bg-white");
    });

    it("keeps the unread dot in the name line when the preview line is gone", () => {
      const markup = renderRow(bot({ unread: true, messages: [{ id: "b1", role: "bot", kind: "text", text: "hello", at: 1 }] as Bot["messages"] }), true);
      expect(markup).toMatch(/sr-only[^>]*>Unread threads</);
      expect(markup).not.toContain(">hello<");
    });

    it("reads the title out and shows the star when quiet rows are off", () => {
      const markup = renderRow(bot({ title: "Developer", chiefOfStaff: true }));
      expect(markup).toContain(">Developer<");
      expect(markup).toContain('data-testid="primary-bot-badge"');
    });
  });
});
