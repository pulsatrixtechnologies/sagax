// #2791: the long lists outside the sidebar are virtualized too, the header's
// thread picker and the Team map's bot cards, through the same VirtualRow.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("lists virtualized outside the sidebar (#2791)", () => {
  it("the thread picker's list is a virtual root and each thread a VirtualRow that keeps its mark while held", () => {
    const picker = read("./TaskPicker.tsx");
    expect(picker).toContain('<div className="max-h-[320px] overflow-y-auto" data-virtual-root=""');
    expect(picker).toContain("<VirtualRow rowKey={`picker:${task.threadId}`} estimate={PICKER_ROW_ESTIMATE} initiallyShown={index < PICKER_FIRST_ROWS}");
    // the open thread, the one renamed and the one with its menu open stay drawn
    expect(picker).toContain("eager={active || renaming === task.threadId || rowMenu?.threadId === task.threadId} heldAttributes={{ \"data-sidebar-thread-row\": task.threadId }}");
  });

  it("the Team map pans both ways and each bot card is a VirtualRow of the card's own size", () => {
    expect(read("./TeamCanvas.tsx")).toContain('data-team-canvas data-virtual-root="both"');
    const layer = read("./TeamCanvas.tsx-parts/TeamSectionsLayer.tsx");
    expect(layer).toContain("const BOT_CARD_HEIGHT = 126;");
    expect(layer).toContain("<VirtualRow key={bot.id} rowKey={`team-card:${bot.id}`} className=\"relative w-[236px]\" estimate={BOT_CARD_HEIGHT} initiallyShown");
    expect(layer).toContain('heldAttributes={{ "data-bot-id": bot.id }}');
    // the card being dragged, moved or edited keeps its content
    expect(layer).toContain("eager={(selectedId === bot.id && settingsOpen) || dragged?.bot.id === bot.id || moving === bot.id || insertion?.botId === bot.id}");
  });

  it("an insertion point measured on a held card falls back to the card's own box", () => {
    expect(read("./TeamCanvas.tsx")).toContain('const bounds = (card?.closest("article") ?? card)?.getBoundingClientRect();');
  });
});
