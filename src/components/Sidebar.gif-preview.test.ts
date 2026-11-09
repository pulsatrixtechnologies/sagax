import { describe, expect, it } from "vitest";
import { preview } from "./Sidebar.tsx-parts/preview";
import { setLocale } from "@/lib/i18n";

// #3204 (regression of #3165 / #1003): a bot row whose last message is a sent
// GIF reads "GIF", never the stored `<attached-image ...>` transport tag, whole
// or clipped mid-attribute by a list payload.
const GIF = '<attached-image path="/data/attachments/abc/cat.gif" name="cat.gif" meme-provider="giphy" meme-attribution="GIPHY" />';
const bot = { activity: "idle", busy: false } as never;
const row = (text: string) => preview(bot, [{ id: "m1", role: "user", kind: "text", text, at: 1 }] as never, []);

describe("bot row preview after a GIF", () => {
  it.each([
    ["a bare GIF", GIF],
    ["a GIF with a caption", `lol\n\n${GIF}`],
    ["a GIF clipped inside its path", '<attached-image path="/d…'],
    ["a GIF clipped after the tag name", "<attached-image"],
    ["a plain image", '<attached-image path="/data/a/b.png" name="b.png" />'],
  ])("%s never shows the raw tag", (_label, text) => {
    setLocale("en");
    const line = row(text);
    expect(line).not.toMatch(/attached-|path=/);
    expect(line).toMatch(/GIF|Image/);
  });

  it("is localized", () => {
    setLocale("fr");
    expect(row(`ok\n\n${'<attached-image path="/d/x.png" name="x.png" />'}`)).toBe("ok Image");
    setLocale("en");
  });
});
