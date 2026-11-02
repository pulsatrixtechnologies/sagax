/** Where a sealed store reads its key. A leaf type: person-connections and
 * mcp-oauth would cycle if this lived in mcp-oauth.ts. */
export type VaultKeySource =
  | { kind: "key"; key: Buffer }
  | { kind: "unavailable"; reason: string };
