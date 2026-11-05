// Section context: a user-owned team brief (#1388 slice P1).
// Bots receive this in their system context, but no agent tool can write it.
import { z } from "zod";
import type { RequestAuth } from "../auth/request-auth.ts";
import {
  SECTION_CONTEXT_MAX_BYTES,
  sectionContextKey,
  sectionContextLabel,
  type SectionContextRecord,
} from "../rooms/section-context.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface SectionContextRouteDeps {
  sections(): readonly string[];
  bots(): readonly { hidden?: boolean; section?: string }[];
  groups(): readonly { section?: string }[];
  sectionKey(section: string | undefined): string;
  /** #2045: storage key for this caller's team (owner/id on org servers). */
  storageKey?(auth: RequestAuth, sectionName: string): string;
  read(section: string): SectionContextRecord | null;
  write(section: string, text: string): SectionContextRecord | null;
}

export function createSectionContextRoutes(deps: SectionContextRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (!(path === "/api/section-context" && (method === "GET" || method === "PUT"))) return PASS;

    if (!url.searchParams.has("section")) return json(res, 400, { error: "section is required" });
    const requested = url.searchParams.get("section") ?? "";
    const section = sectionContextKey(requested);
    if (section.length > 60) return json(res, 400, { error: "section must be at most 60 characters" });
    const exists =
      section === "" ||
      deps.sections().includes(section) ||
      deps.bots().some((bot) => !bot.hidden && deps.sectionKey(bot.section) === section) ||
      deps.groups().some((group) => deps.sectionKey(group.section) === section);
    if (!exists) return json(res, 404, { error: "no such team" });
    const key = deps.storageKey?.(auth, section) ?? section;

    if (method === "GET") {
      const context = deps.read(key);
      return json(res, 200, {
        section,
        label: sectionContextLabel(section),
        text: context?.text ?? "",
        updatedAt: context?.updatedAt ?? null,
        maxBytes: SECTION_CONTEXT_MAX_BYTES,
      });
    }

    const parsed = z.object({ text: z.string() }).safeParse(await readBody(req));
    if (!parsed.success) return json(res, 400, { error: "text must be a string" });
    if (Buffer.byteLength(parsed.data.text, "utf8") > SECTION_CONTEXT_MAX_BYTES) {
      return json(res, 400, { error: `section context is capped at ${SECTION_CONTEXT_MAX_BYTES / 1000}KB` });
    }
    const context = deps.write(key, parsed.data.text);
    return json(res, 200, {
      ok: true,
      section,
      label: sectionContextLabel(section),
      text: context?.text ?? "",
      updatedAt: context?.updatedAt ?? null,
      maxBytes: SECTION_CONTEXT_MAX_BYTES,
    });
  };
}
