// @ts-nocheck
/** importPackageFor (#1388). Pure move from server/index.ts. */
import { PackageImportError } from "../packages/package-import.ts";
import { importPackageDocument } from "../packages/package-import.ts";
export type Host = Record<string, any>;

export function createImportPackageFor(getHost: () => Host): any {
async function importPackageFor(raw: unknown, ownerPrincipalId: string): Promise<{ bots: BotRecord[]; warnings: string[] }> {
  const host = getHost();

  let document: PackageDocument;
  try {
    if (!host.isBotPackage(raw)) throw new Error("This is not a Sagax bot package.");
    document = host.parsePackageDocument(raw, { trust: "file" });
  } catch (error) {
    throw new host.ConsoleRefusal(400, "invalid_package", error instanceof Error ? error.message.slice(0, 300) : "Invalid bot package.");
  }
  let result: PackageImportResult;
  try {
    const imported = importPackageDocument(document, { mode: "add", cwd: null, trust: "file" }, host.packageImportDeps(await host.defaultSelection()));
    if (imported.alreadyAdded) throw new host.ConsoleRefusal(409, "already_added", "This package was already added.");
    result = imported;
  } catch (error) {
    if (error instanceof PackageImportError) throw new host.ConsoleRefusal(error.status, error.code ?? "import_refused", error.message);
    throw error;
  }
  for (const bot of result.bots) host.store.patchBot(bot.id, { ownerUserId: ownerPrincipalId });
  host.botMailResync();
  host.settleMemberAutoLevels(result.bots.map((bot) => bot.id));
  for (const bot of result.bots) {
    const current = host.store.bot(bot.id);
    if (current) host.broadcast({ kind: "bot", bot: host.publicBot(current) });
  }
  return { bots: result.bots, warnings: result.skipped.map((skip) => `${skip.part}: ${skip.reason}`) };

}
  return importPackageFor;
}
