import { describe, expect, it } from "vitest";
import { bareImageKind, bareImageLines, replaceBareImageUrls } from "../../shared/bare-image-urls";
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
