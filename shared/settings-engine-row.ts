export type EngineRow = { instanceId?: unknown; displayName?: unknown; driverKind?: unknown; readOnly?: unknown; access?: unknown; snapshot?: { state?: unknown; authenticated?: unknown; account?: { email?: unknown; method?: unknown }; version?: unknown }; authentication?: { method?: unknown; signOut?: unknown }; claudeAccount?: { isDefault?: unknown }; models?: { default?: unknown } };
export const engineRow = (row: EngineRow) => ({
  instanceId: row.instanceId, name: row.displayName, driver: row.driverKind,
  ...(row.access ? { access: row.access } : {}),
  state: row.snapshot?.state, signedIn: row.snapshot?.authenticated ?? null,
  ...(row.snapshot?.account?.email ? { account: row.snapshot.account.email } : {}),
  ...(row.snapshot?.version ? { version: row.snapshot.version } : {}),
  ...(row.authentication?.method ? { signIn: row.authentication.method } : {}),
  ...(row.claudeAccount ? { claudeAccount: true } : {}),
  ...(row.models?.default ? { defaultModel: row.models.default } : {}),
  ...(row.readOnly ? { readOnly: true } : {}),
});
