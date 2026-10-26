// The bot package: one bot, whole, as `<bot-name>.sagaxbot.zip` (server
// side in server/bot-zip.ts, docs/bot-package.md). This module holds what
// the server, the renderer's preview and the admin console share: the
// manifest's schema, the limits, the file name and the preview's shape.
// Pure: zod only.
import { z } from "zod";

export const BOT_ZIP_FORMAT = "sagax.bot";
/** The newest version this build reads and writes. */
export const BOT_ZIP_VERSION = 1;
export const BOT_ZIP_MAX_BYTES = 512 * 1024 * 1024;
export const BOT_ZIP_MAX_ENTRIES = 20_000;
export const BOT_ZIP_EXTENSION = ".sagaxbot.zip";
export const BOT_ZIP_NEWER_MESSAGE = "This bot was exported by a newer Sagax. Update the app, then import it again.";

/** What a zip holds, part by part (counts of files or records). */
export const botZipIncludesSchema = z.object({
  identity: z.boolean(),
  avatar: z.boolean(),
  soul: z.boolean(),
  rules: z.boolean(),
  memory: z.number().int().nonnegative(),
  docs: z.number().int().nonnegative(),
  workspace: z.number().int().nonnegative(),
  skills: z.number().int().nonnegative(),
  plugins: z.number().int().nonnegative(),
  marketplaces: z.number().int().nonnegative(),
  mcpServers: z.number().int().nonnegative(),
  perspicaxProfiles: z.number().int().nonnegative(),
  routines: z.number().int().nonnegative(),
  webhooks: z.number().int().nonnegative(),
  sharing: z.number().int().nonnegative(),
  conversations: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  attachments: z.number().int().nonnegative(),
}).partial().catchall(z.unknown());
export type BotZipIncludes = z.infer<typeof botZipIncludesSchema>;

const nameText = z.string().trim().min(1).max(200);

export const botZipManifestSchema = z.object({
  format: z.literal(BOT_ZIP_FORMAT, { error: "This zip is not a Sagax bot." }),
  version: z.number().int().min(1),
  appVersion: z.string().max(64),
  exportedAt: z.number().int().nonnegative(),
  bot: z.object({ id: z.string().min(1).max(128), name: nameText }),
  includes: botZipIncludesSchema,
  /** Secrets replaced by the redactor on the way out. */
  redacted: z.number().int().nonnegative().default(0),
  marketplaces: z.array(z.object({
    name: nameText,
    source: z.string().max(500),
    ref: z.string().max(200).optional(),
    /** The marketplace was read with a token: a new one is asked on import. */
    needsToken: z.boolean().default(false),
  })).max(50).default([]),
  mcpServers: z.array(z.object({
    name: z.string().min(1).max(64),
    transport: z.string().max(20).optional(),
    url: z.string().max(2_000).optional(),
    command: z.string().max(500).optional(),
    /** Header or environment value names; never their values. */
    valueNames: z.array(z.string().max(200)).max(50).default([]),
  })).max(100).default([]),
  excluded: z.array(z.string().max(300)).max(50).default([]),
});
export type BotZipManifest = z.infer<typeof botZipManifestSchema>;

/** `Atlas Bot` → `atlas-bot.sagaxbot.zip`. */
export function botZipFilename(name: string): string {
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${slug || "bot"}${BOT_ZIP_EXTENSION}`;
}

export interface BotZipExportOptions {
  /** Threads, messages and their attachments (off by default). */
  conversations: boolean;
  /** Grants and visibility, people named by email. */
  sharing: boolean;
}

/** One line of the preview: what is created, skipped or needs a step. */
export interface BotZipPreviewLine {
  part: string;
  /** English text, shown when the client has no translation; never a secret. */
  detail: string;
  /** The client's translation (`botZip.line.*`) and its values. */
  key?: string;
  params?: Record<string, string | number>;
}

export interface BotZipPreview {
  /** "zip": a sagax.bot archive; "legacy": an older openmaus.package file. */
  kind: "zip" | "legacy";
  name: string;
  /** The name the copy gets here (a suffix when the name is taken). */
  importName: string;
  appVersion?: string;
  exportedAt?: number;
  includes: BotZipIncludes;
  /** The file carries conversations (the import switch is offered). */
  hasConversations: boolean;
  hasSharing: boolean;
  created: BotZipPreviewLine[];
  skipped: BotZipPreviewLine[];
  /** Marketplaces or apps that need a token or a sign-in after import. */
  needsAction: BotZipPreviewLine[];
}

export interface BotZipImportResult {
  botId: string;
  name: string;
  warnings: string[];
}
