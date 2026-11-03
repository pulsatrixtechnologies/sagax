// Routine folders (2026-10-28, shared/routine-folders.ts).
//
//   POST /api/routines/folders  { action, botId, ... }
//        create   { name }             an empty folder at the end
//        rename   { from, to }         onto another folder: the two merge
//        delete   { name }             its routines go back to no folder
//        reorder  { order }            the person's order of the folders
//        move     { routineIds, folder }  folder null: out of any folder
//        sort-by-prefix                "[X] Title" -> folder X, "Title";
//                                      answers { undo } for the Undo
//        restore  { undo }             puts back what an action changed
//   Answers { folders, routines, undo? }: the bot's folders in order and the
//   routines the action changed. The folder list itself rides GET
//   /api/routines (`folders`) and the `routine.folders` frame.
//
// Whoever may change the bot's routines (its owner, or on an organization
// server a member with the right to run it) may arrange their folders: no
// admin right. A bot the caller cannot see is 404.
import { z } from "zod";

import type { RequestAuth } from "../auth/request-auth.ts";
import { ROUTINE_FOLDER_MAX, type RoutineFolderUndo } from "../../shared/routine-folders.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface RoutineFolderManager<R> {
  createFolder(botId: string, name: string): RoutineFolderResultOf<R>;
  renameFolder(botId: string, from: string, to: string): RoutineFolderResultOf<R> | null;
  deleteFolder(botId: string, name: string): RoutineFolderResultOf<R> | null;
  reorderFolders(botId: string, order: readonly string[]): RoutineFolderResultOf<R>;
  moveToFolder(botId: string, routineIds: readonly string[], folder: string | null): RoutineFolderResultOf<R>;
  sortByPrefix(botId: string): RoutineFolderResultOf<R>;
  restoreFolders(botId: string, undo: RoutineFolderUndo): RoutineFolderResultOf<R>;
}

export interface RoutineFolderResultOf<R> {
  folders: string[];
  routines: R[];
  undo?: RoutineFolderUndo;
}

export interface RoutineFolderRouteDeps<R> {
  /** Whether this caller may change this bot's routines: "hidden" for a bot
   * they cannot see (404), "needs_run" without the right to run it (403). */
  access(auth: RequestAuth, botId: string): "ok" | "hidden" | "needs_run";
  manager(): RoutineFolderManager<R> | null;
  onWire(routine: R): unknown;
}

const name = z.string().min(1).max(ROUTINE_FOLDER_MAX * 2);
const botId = z.string().min(1).max(200);
const undoSchema = z.object({
  botId,
  folders: z.array(name).max(200),
  routines: z.array(z.object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(200),
    folder: name.optional(),
  }).strict()).max(1000),
}).strict();

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), botId, name }).strict(),
  z.object({ action: z.literal("rename"), botId, from: name, to: name }).strict(),
  z.object({ action: z.literal("delete"), botId, name }).strict(),
  z.object({ action: z.literal("reorder"), botId, order: z.array(name).max(200) }).strict(),
  z.object({ action: z.literal("move"), botId, routineIds: z.array(z.string().min(1).max(128)).min(1).max(1000), folder: name.nullable() }).strict(),
  z.object({ action: z.literal("sort-by-prefix"), botId }).strict(),
  z.object({ action: z.literal("restore"), botId, undo: undoSchema }).strict(),
]);

export function createRoutineFolderRoutes<R>(deps: RoutineFolderRouteDeps<R>): RouteHandler {
  return async ({ res, path, method, auth, json, readBody, req }) => {
    if (path !== "/api/routines/folders" || method !== "POST") return PASS;
    const parsed = bodySchema.safeParse(await readBody(req));
    if (!parsed.success) return json(res, 400, { error: "send { action, botId, ... } (create, rename, delete, reorder, move, sort-by-prefix, restore)" });
    const body = parsed.data;
    const access = deps.access(auth, body.botId);
    if (access === "hidden") return json(res, 404, { error: "no such bot" });
    if (access === "needs_run") return json(res, 403, { error: "you need the right to run this bot's routines", code: "needs_run" });
    if (body.action === "restore" && body.undo.botId !== body.botId) return json(res, 400, { error: "This undo belongs to another bot" });
    const manager = deps.manager();
    if (!manager) return json(res, 503, { error: "Routines are not available" });
    let result: RoutineFolderResultOf<R> | null;
    try {
      switch (body.action) {
        case "create": result = manager.createFolder(body.botId, body.name); break;
        case "rename": result = manager.renameFolder(body.botId, body.from, body.to); break;
        case "delete": result = manager.deleteFolder(body.botId, body.name); break;
        case "reorder": result = manager.reorderFolders(body.botId, body.order); break;
        case "move": result = manager.moveToFolder(body.botId, body.routineIds, body.folder); break;
        case "sort-by-prefix": result = manager.sortByPrefix(body.botId); break;
        case "restore": result = manager.restoreFolders(body.botId, body.undo); break;
      }
    } catch (error) {
      const status = (error as { status?: unknown }).status;
      if (status === 404 || status === 503) return json(res, status, { error: (error as Error).message });
      return json(res, 400, { error: error instanceof Error ? error.message : "Could not change the folders" });
    }
    if (!result) return json(res, 404, { error: "no such folder" });
    return json(res, 200, {
      folders: result.folders,
      routines: result.routines.map((routine) => deps.onWire(routine)),
      ...(result.undo ? { undo: result.undo } : {}),
    });
  };
}
