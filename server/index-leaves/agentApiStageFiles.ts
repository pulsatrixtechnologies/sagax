// @ts-nocheck
/** agentApiStageFiles (#1388). Pure move from server/index.ts. */
import { SEND_FILE_MAX_BYTES as AGENT_SEND_FILE_MAX_BYTES } from "../agent-api.ts";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { escapeAttribute } from "../attachments/attachment-staging.ts";
import { PRIVATE_FILES_NOTE } from "../messages/staged-file-refs.ts";
export type Host = Record<string, any>;

export function createAgentApiStageFiles(getHost: () => Host): any {
function agentApiStageFiles(caller: AgentCaller, target: BotRecord, files: FileInput[], text: string, threadId?: string) {
  const host = getHost();
  const { agentRefuse, workspaceDir } = host;
  if (!files.length) return { text, staged: [] };
  const from = host.agentApiCallerBot(caller);
  const slug = (caller.name || caller.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "agent";
  const sources: Array<{ name: string; read: () => Buffer }> = [];
  for (const file of files) {
    const name = basename(file.path) || "file";
    if (file.content_base64 !== undefined) {
      const bytes = Buffer.from(file.content_base64, "base64");
      if (bytes.length > AGENT_SEND_FILE_MAX_BYTES) return agentRefuse(413, "file_too_large", `${file.path} is larger than 25 MiB.`);
      sources.push({ name, read: () => bytes });
    } else if (from && caller.sourceThreadId) {
      const found = host.agentApiSourceFile(from, caller.sourceThreadId, file.path);
      if ("code" in found) return found;
      // a memory file sealed at rest travels as its plaintext (server/encryption/content-at-rest.ts)
      sources.push({ name, read: () => host.readAtRestSync(found.path) });
    } else {
      return agentRefuse(400, "bad_request", `${file.path}: send the file's bytes (content_base64).`);
    }
  }
  const person = caller.kind === "person" ? caller.id : host.privateThreadOwner(host.store.taskByThread(target.id, threadId), host.effectiveBotOwner(target));
  if (host.privateThreads() && person && person.toLowerCase() !== host.effectiveBotOwner(target).toLowerCase()) {
    const paths: string[] = [];
    const tags: string[] = [];
    try {
      for (const source of sources) {
        const path = host.saveAgentAttachment(source.read(), source.name, person);
        paths.push(path);
        host.attachmentUploaders.record(basename(path), person);
        tags.push(`<attached-file path="${escapeAttribute(path)}" name="${escapeAttribute(source.name)}" />`);
      }
      return { text: [text + PRIVATE_FILES_NOTE, ...tags].join("\n\n"), staged: paths.map(path => "attachments/" + basename(path)) };
    } catch (error) {
      for (const path of paths) host.deleteAttachment(path);
      throw error;
    }
  }
  const folder = join(workspaceDir(target.id), "inbox", slug);
  mkdirSync(folder, { recursive: true });
  const written: string[] = [];
  for (const source of sources) {
    let name = source.name;
    for (let n = 2; existsSync(join(folder, name)); n++) name = `${source.name.replace(/(\.[^.]*)?$/, `-${n}$1`)}`;
    writeFileSync(join(folder, name), source.read());
    written.push(["inbox", slug, name].join("/"));
  }
  return { text: host.agentPromptWithFiles(text, written, workspaceDir(target.id)), staged: written };

}
  return agentApiStageFiles;
}
