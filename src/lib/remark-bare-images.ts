// A bare GIF / picture URL on a line of its own becomes an image node that the
// chat draws as the picture (the same MemeImage a person's sent GIF uses),
// keeping the text around it. `data-bare-image` tells the img renderer to use
// that look, not the gated "Load image" frame an author-written `![](url)` gets.
//
// A link to a playable file (an `.m3u8` stream, a video, an audio clip:
// shared/bare-image-urls.ts `bareMediaKind`) gets a player the same way: an
// own-line address becomes the player, which shows the address under it; a
// link inside a sentence or with a label keeps its text and the player comes
// right under that paragraph. `data-bare-media` tells the div renderer.
import { bareImageKind, bareMediaKind, type BareImageKind, type BareMediaKind } from "../../shared/bare-image-urls.ts";

type MdNode = { type: string; value?: string; url?: string; children?: MdNode[]; data?: Record<string, unknown> };

function linkUrl(node: MdNode | undefined): string | null {
  if (!node || node.type !== "link" || !node.url) return null;
  // a bare address: the label is the address itself (autolink / <url>)
  const label = node.children?.length === 1 && node.children[0]!.type === "text" ? node.children[0]!.value : undefined;
  return label !== undefined && label.trim() === node.url ? node.url : null;
}

const startsLine = (prev: MdNode | undefined) =>
  !prev || prev.type === "break" || (prev.type === "text" && /\n[ \t]*$/.test(prev.value ?? ""));
const endsLine = (next: MdNode | undefined) =>
  !next || next.type === "break" || (next.type === "text" && /^[ \t]*\n/.test(next.value ?? ""));

type Figure = { url: string; node: MdNode };

/** The player of one media address; `link` says whether it shows the address
 * (the text does not: an own-line address it replaced, or a link's label). */
function mediaFigure(url: string, kind: BareMediaKind, link: "show" | "hide"): MdNode {
  return {
    type: "paragraph",
    data: {
      hName: "div",
      hProperties: { "data-bare-media": kind, "data-media-url": url, "data-media-link": link },
    },
    children: [],
  };
}

function pictureAt(kids: MdNode[], i: number): Figure | null {
  const url = linkUrl(kids[i]);
  if (!url || !startsLine(kids[i - 1]) || !endsLine(kids[i + 1])) return null;
  const kind: BareImageKind | null = bareImageKind(url);
  // a div, not a p: the picture is a figure, which a paragraph cannot hold
  if (kind) return { url, node: { type: "paragraph", data: { hName: "div" }, children: [{ type: "image", url, data: { hProperties: { "data-bare-image": kind, alt: "" } } }] } };
  const media = bareMediaKind(url);
  return media ? { url, node: mediaFigure(url, media, "show") } : null;
}

/** The media links a paragraph still holds, in order: bare ones (the text
 * shows the address) and labeled ones (it shows the label). */
function mediaLinks(node: MdNode, out: Array<{ url: string; kind: BareMediaKind; bare: boolean }> = []) {
  for (const child of node.children ?? []) {
    if (child.type === "link" && child.url) {
      const kind = bareMediaKind(child.url);
      if (kind) out.push({ url: child.url, kind, bare: linkUrl(child) !== null });
      continue;
    }
    mediaLinks(child, out);
  }
  return out;
}

/** Each paragraph that links to media, followed by the player of each address
 * not already drawn in this message. */
function withPlayers(nodes: MdNode[], drawn: Set<string>): MdNode[] {
  return nodes.flatMap((node) => {
    const hp = node.data?.hProperties as Record<string, unknown> | undefined;
    if (typeof hp?.["data-media-url"] === "string") {
      if (drawn.has(hp["data-media-url"])) return [];
      drawn.add(hp["data-media-url"]);
      return [node];
    }
    if (node.type !== "paragraph" || node.data?.hName) return [node];
    const players: MdNode[] = [];
    for (const link of mediaLinks(node)) {
      if (drawn.has(link.url)) continue;
      drawn.add(link.url);
      players.push(mediaFigure(link.url, link.kind, link.bare ? "hide" : "show"));
    }
    return [node, ...players];
  });
}

function splitParagraph(paragraph: MdNode): MdNode[] | null {
  const kids = paragraph.children ?? [];
  if (!kids.some((_, i) => pictureAt(kids, i))) return null;
  const out: MdNode[] = [];
  let run: MdNode[] = [];
  const flush = () => {
    if (run.some((child) => child.type !== "text" || (child.value ?? "").trim())) out.push({ type: "paragraph", children: run });
    run = [];
  };
  let skipHead = false;
  kids.forEach((child, i) => {
    if (skipHead) {
      skipHead = false;
      if (child.type === "break") return;
      if (child.type === "text") {
        const value = (child.value ?? "").replace(/^[ \t]*\n/, "");
        if (value) run.push({ ...child, value });
        return;
      }
    }
    const hit = pictureAt(kids, i);
    if (!hit) {
      run.push(child);
      return;
    }
    const last = run.at(-1);
    if (last?.type === "text") {
      const value = (last.value ?? "").replace(/[ \t]*\n[ \t]*$/, "");
      if (value) run[run.length - 1] = { ...last, value };
      else run.pop();
    } else if (last?.type === "break") run.pop();
    flush();
    out.push(hit.node);
    skipHead = true;
  });
  flush();
  return out;
}

export function remarkBareImages() {
  return (tree: MdNode) => {
    // one player per address in a message, at its first link
    const drawn = new Set<string>();
    const visit = (node: MdNode) => {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type === "paragraph") return withPlayers(splitParagraph(child) ?? [child], drawn);
        visit(child);
        return [child];
      });
    };
    visit(tree);
  };
}
