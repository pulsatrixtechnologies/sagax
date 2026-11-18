import { describe, expect, it } from "vitest";
import { bareImageKind, bareImageLines, bareMediaKind, replaceBareImageUrls } from "../../shared/bare-image-urls";
import { plainPreviewText } from "./plain-preview";
import { remarkBareImages } from "./remark-bare-images";
import { fromMarkdown, type Options } from "mdast-util-from-markdown";
import remarkGfm from "remark-gfm";

const gfm: { micromarkExtensions?: Options["extensions"]; fromMarkdownExtensions?: Options["mdastExtensions"] } = {};
remarkGfm.call({ data: () => gfm });

const GIF = "https://media3.giphy.com/media/abc123XYZ/giphy.gif";

describe("bareImageKind", () => {
  it.each([
    [GIF, "gif"],
    ["https://media.giphy.com/media/abc/giphy.gif?cid=1&rid=giphy.gif", "gif"],
    ["https://i.giphy.com/media/abc/giphy.webp", "image"],
    ["https://media.giphy.com/media/abc/giphy", "gif"],
    ["https://media.tenor.com/xyz/cat.gif", "gif"],
    ["https://example.com/a/b.PNG", "image"],
    ["https://example.com/a/b.jpg", "image"],
    ["https://example.com/a/b.jpeg", "image"],
    ["https://example.com/a/b.webp", "image"],
  ])("%s is a picture", (url, kind) => expect(bareImageKind(url)).toBe(kind));

  it.each([
    "https://giphy.com/gifs/cat-abc123",
    "https://tenor.com/view/cat-gif-123",
    "https://example.com/page",
    "https://example.com/a.gif extra",
    "ftp://example.com/a.gif",
    "not a url",
  ])("%s is not", (url) => expect(bareImageKind(url)).toBeNull());
});

describe("bareImageLines", () => {
  it("finds an own-line URL, not one in a sentence or a code fence", () => {
    expect(bareImageLines(`salut\n\n${GIF}`)).toEqual([{ line: 2, url: GIF, kind: "gif" }]);
    expect(bareImageLines(`voir ${GIF} ici`)).toEqual([]);
    expect(bareImageLines("```\n" + GIF + "\n```")).toEqual([]);
  });
  it("labels it in a preview", () => {
    expect(replaceBareImageUrls(`ok\n${GIF}`, (k) => (k === "gif" ? "GIF" : "Image"))).toBe("ok\nGIF");
  });
  it("the sidebar preview never shows the URL", () => {
    const line = plainPreviewText(`Un petit salut.\n\n${GIF}`);
    expect(line).not.toContain("giphy");
    expect(line).toMatch(/GIF/);
  });
});

function run(md: string) {
  const tree = fromMarkdown(md, { extensions: gfm.micromarkExtensions, mdastExtensions: gfm.fromMarkdownExtensions });
  remarkBareImages()(tree as never);
  return tree as unknown as { children: Array<{ type: string; data?: { hName?: string }; children?: Array<{ type: string; value?: string; url?: string; data?: { hProperties?: Record<string, unknown> } }> }> };
}

describe("remarkBareImages", () => {
  it("turns an own-line GIF URL into an image and keeps the text above", () => {
    const tree = run(`Alex t'envoie ce salut.\n\n${GIF}`);
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0]!.children![0]!.value).toContain("salut");
    const picture = tree.children[1]!;
    expect(picture.data?.hName).toBe("div");
    expect(picture.children![0]).toMatchObject({ type: "image", url: GIF });
    expect(picture.children![0]!.data?.hProperties?.["data-bare-image"]).toBe("gif");
  });
  it("splits a paragraph where the URL is on the last line", () => {
    const tree = run(`salut\n${GIF}`);
    expect(tree.children.map((child) => child.children![0]!.type)).toEqual(["text", "image"]);
  });
  it("leaves a URL inside a sentence and a page link alone", () => {
    expect(run(`voir ${GIF} ici`).children[0]!.children!.some((c) => c.type === "image")).toBe(false);
    expect(run("https://giphy.com/gifs/cat-abc").children[0]!.children![0]!.type).toBe("link");
  });
});

const HLS = "https://media.example.test/v1/share/recordings/abc/index.m3u8?u=1&exp=1763300000&t=sig";

describe("bareMediaKind", () => {
  it.each([
    [HLS, "hls"],
    ["https://cdn.example.test/clip.mp4", "video"],
    ["https://cdn.example.test/clip.MOV?sig=1", "video"],
    ["https://cdn.example.test/clip.webm", "video"],
    ["https://cdn.example.test/clip.m4v", "video"],
    ["https://cdn.example.test/song.mp3", "audio"],
    ["https://cdn.example.test/song.m4a?exp=1&t=2", "audio"],
    ["https://cdn.example.test/song.ogg", "audio"],
    ["https://cdn.example.test/song.wav", "audio"],
  ])("%s plays as %s", (url, kind) => expect(bareMediaKind(url)).toBe(kind));

  it.each([
    "http://cdn.example.test/clip.mp4",
    "https://cdn.example.test/watch?v=clip.mp4",
    "https://cdn.example.test/page",
    "https://cdn.example.test/a.gif",
    "javascript:alert(1)//a.mp4",
    "https://cdn.example.test/clip.mp4 extra",
  ])("%s is not playable in place", (url) => expect(bareMediaKind(url)).toBeNull());
});

type MediaNode = { type: string; data?: { hName?: string; hProperties?: Record<string, unknown> }; children?: Array<{ type: string; value?: string; url?: string }> };
const mediaNodes = (md: string) =>
  (run(md).children as MediaNode[]).filter((child) => child.data?.hProperties?.["data-bare-media"]);

describe("remarkBareImages media links", () => {
  it("turns an own-line media URL into a player that shows the link", () => {
    const tree = run(`Voici l'enregistrement.\n\n${HLS}`);
    expect(tree.children).toHaveLength(2);
    const player = tree.children[1] as MediaNode;
    expect(player.data?.hName).toBe("div");
    expect(player.data?.hProperties).toMatchObject({ "data-bare-media": "hls", "data-media-url": HLS, "data-media-link": "show" });
  });
  it("keeps a media link inside a sentence and adds the player under its paragraph", () => {
    const tree = run(`Le lien ${HLS} marche 10 minutes.`);
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0]!.children!.some((c) => c.type === "link" && c.url === HLS)).toBe(true);
    expect((tree.children[1] as MediaNode).data?.hProperties).toMatchObject({ "data-bare-media": "hls", "data-media-link": "hide" });
  });
  it("shows the address under the player of a labeled link", () => {
    const nodes = mediaNodes("[Écouter](https://cdn.example.test/song.mp3) ou **[voir](https://cdn.example.test/clip.mp4)**");
    expect(nodes.map((n) => [n.data?.hProperties?.["data-bare-media"], n.data?.hProperties?.["data-media-link"]])).toEqual([["audio", "show"], ["video", "show"]]);
  });
  it("draws one player per address and none for a page, a picture or plain http", () => {
    expect(mediaNodes(`${HLS}\n\nencore ${HLS}`)).toHaveLength(1);
    expect(mediaNodes("https://cdn.example.test/page http://cdn.example.test/clip.mp4")).toHaveLength(0);
    expect(mediaNodes(GIF)).toHaveLength(0);
  });
  it("draws a media link in a list item", () => {
    expect(mediaNodes(`- ${HLS}`)).toHaveLength(0);
    const tree = run(`- ${HLS}`) as unknown as { children: Array<{ children: Array<{ children: MediaNode[] }> }> };
    const item = tree.children[0]!.children[0]!.children;
    expect(item.some((n) => n.data?.hProperties?.["data-bare-media"] === "hls")).toBe(true);
  });
});
