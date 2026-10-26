// What the bot library's hover card shows for a file (reference design): the
// picture for an image, the first lines for text, otherwise the file's icon,
// name and size. The text is read only when a card opens, at most
// TEXT_PREVIEW_BYTES of it, once per file (cached for the session).
import { classifyFile, fileExtension, type ThreadFile } from "@/lib/chat-files";

export type FilePreviewKind = "image" | "text" | "meta";

export const TEXT_PREVIEW_LINES = 12;
export const TEXT_PREVIEW_BYTES = 16 * 1024;
/** Above this a text file is not read for a card at all. */
export const TEXT_PREVIEW_MAX_FILE = 5 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "log", "json", "jsonc", "yaml", "yml", "toml", "xml", "ini", "env.example",
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "mts", "cts", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp",
  "hpp", "cs", "php", "sh", "bash", "zsh", "fish", "ps1", "sql", "lua", "r", "dart", "scala", "vue", "svelte", "css",
  "scss", "less", "html", "htm",
]);

export function filePreviewKind(file: Pick<ThreadFile, "name" | "mime" | "size" | "available">): FilePreviewKind {
  if (!file.available) return "meta";
  const kind = classifyFile(file);
  if (kind === "image") return "image";
  const mime = (file.mime ?? "").toLowerCase();
  const texty = mime.startsWith("text/") || /^application\/(json|xml|x-yaml|yaml|toml|javascript|typescript)/.test(mime)
    || TEXT_EXTENSIONS.has(fileExtension(file.name));
  if (!texty || (file.size !== null && file.size > TEXT_PREVIEW_MAX_FILE)) return "meta";
  return "text";
}

/** The first lines of what was read; a cut last line is dropped when more
 * text followed it. */
export function firstLines(text: string, truncated: boolean, lines = TEXT_PREVIEW_LINES): string {
  const all = text.replace(/\r\n?/g, "\n").split("\n");
  if (truncated && all.length > 1) all.pop();
  return all.slice(0, lines).join("\n").replace(/\s+$/, "");
}

const cache = new Map<string, string>();

/** Reads the start of a file and keeps its first lines. */
export async function loadTextPreview(url: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<string> {
  const known = cache.get(url);
  if (known !== undefined) return known;
  const response = await fetcher(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  let bytes = new Uint8Array(0);
  let truncated = false;
  const reader = response.body?.getReader();
  if (reader) {
    while (bytes.length < TEXT_PREVIEW_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const next = new Uint8Array(bytes.length + value.length);
      next.set(bytes);
      next.set(value, bytes.length);
      bytes = next;
    }
    if (bytes.length >= TEXT_PREVIEW_BYTES) {
      truncated = true;
      void reader.cancel().catch(() => undefined);
    }
  } else {
    const text = await response.text();
    truncated = text.length > TEXT_PREVIEW_BYTES;
    bytes = new TextEncoder().encode(text.slice(0, TEXT_PREVIEW_BYTES));
  }
  const text = firstLines(new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, TEXT_PREVIEW_BYTES)), truncated);
  cache.set(url, text);
  return text;
}

export function clearTextPreviewCache(): void {
  cache.clear();
}
