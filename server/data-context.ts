// The HTTP boundary of a message's Data context (shared/data-context.ts):
// a card id as the sheet mints them and a bounded draft, a page reference,
// or a 400.
import { z } from "zod";

import type { DataContext } from "../shared/data-context.ts";
import { parsePageQuote } from "../shared/page-threads.ts";

export type { DataContext };

/** A draft is one editor's contents; anything larger is not a draft. */
export const DATA_CONTEXT_DRAFT_MAX_BYTES = 100 * 1024;

const pageContextSchema = z.object({
  pageId: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
  title: z.string().max(200).transform((title) => title.replace(/\s+/g, " ").trim().slice(0, 120)),
  version: z.number().int().min(1).max(9999).optional(),
  // the passage the person selected and asks about (#4099): the annotation
  // anchor, cut by its limits (shared/page-threads.ts parsePageQuote)
  selection: z.unknown().transform((value, ctx) => {
    const anchor = parsePageQuote(value);
    if (!anchor) ctx.addIssue({ code: "custom", message: "selection is not a page anchor" });
    return anchor ?? z.NEVER;
  }).optional(),
}).strict();

const dataContextSchema = z.object({
  cardId: z.string().regex(/^c_\d+$/).optional(),
  draftSql: z.string().refine((draft) => Buffer.byteLength(draft) <= DATA_CONTEXT_DRAFT_MAX_BYTES, "draftSql is too large").optional(),
  // the page open over the conversation (2026-10-28): checked against its
  // person and bot by the caller (server/index.ts ownPageContext)
  page: pageContextSchema.optional(),
}).strict().refine((context) => Boolean(context.cardId) || Boolean(context.page), "a Data card or a page")
  .refine((context) => context.draftSql === undefined || Boolean(context.cardId), "draftSql goes with a Data card");

/** Parse an optional `dataContext` from a messages POST body. */
export function parseDataContext(value: unknown): DataContext | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = dataContextSchema.safeParse(value);
  if (!parsed.success) {
    throw Object.assign(new Error("dataContext must name a Data card (c_<n>) with an optional draftSql of at most 100 KB, or a page ({ pageId, title, version?, selection? })"), { status: 400 });
  }
  const { cardId, draftSql, page } = parsed.data;
  return { ...(cardId ? { cardId } : {}), ...(draftSql !== undefined ? { draftSql } : {}), ...(page ? { page: { pageId: page.pageId, title: page.title, ...(page.version !== undefined ? { version: page.version } : {}), ...(page.selection ? { selection: page.selection } : {}) } } : {}) };
}
