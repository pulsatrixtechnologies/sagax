// @ts-nocheck
/** migrateBotRuntimeSettings (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMigrateBotRuntimeSettings(getHost: () => Host): any {
function migrateBotRuntimeSettings() {
  const host = getHost();
  const { DATA_DIR, existsSync, writeFileSync } = host;

  const marker = join(DATA_DIR, RUNTIME_SETTINGS_MIGRATION_MARKER);
  if (existsSync(marker)) return;
  try {
    const plan = planRuntimeSettingsMigration(host.store.bots, host.cfg);
    for (const entry of plan) host.store.patchBot(entry.botId, entry.patch);
    writeFileSync(marker, `${new Date().toISOString()} ${plan.length}\n`, { mode: 0o600 });
    console.log(`[bot-runtime-settings] ${plan.length} bot(s) took the global parallel conversations and recovery values`);
  } catch (error) {
    console.warn(`[bot-runtime-settings] could not copy the global values onto the bots: ${error instanceof Error ? error.message : String(error)}`);
  }

}
  return migrateBotRuntimeSettings;
}
