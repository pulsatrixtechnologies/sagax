// Pre-boot marketplace seeding for verification fixtures.
// Lot 5 migrates marketplaces/state.json into the sealed installation store
// at boot and then ignores the legacy file. Suites that used to call
// PluginMarketplaces.adopt after boot must seed before the server starts.
import { PluginMarketplaces, type SharedMarketplaceRecord } from "../plugin-marketplaces.ts";

/** Write a marketplace record into DATA_DIR/marketplaces/state.json before
 * the server boots so migration absorbs it. Returns the marketplaces handle
 * so the caller can write checkout files under repoPath(name). */
export function seedMarketplaceBeforeBoot(
  dataDir: string,
  input: { name: string; record: SharedMarketplaceRecord },
): PluginMarketplaces {
  const markets = new PluginMarketplaces({
    dataDir,
    gitEnvironment: () => ({}),
    policy: () => undefined,
  });
  markets.adopt(input);
  return markets;
}
