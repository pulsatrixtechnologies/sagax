// Isolated preview of the Marketplaces section with per-marketplace
// visibility: the add form carries the Private/Organisation choice, and each
// row shows a scope badge (the owner's rows toggle it). No /api call is made.
import { createRoot } from "react-dom/client";
import { MarketplacesSection, type MarketplaceSummary } from "../../src/components/plugins/MarketplacesSection";
import { applySkin, readSkin } from "../../src/lib/skins";
import "../../src/styles.css";

const marketplaces: MarketplaceSummary[] = [
  {
    name: "devjc", source: "jencryzthers/marketplace", visibility: "private", mine: true,
    plugins: [{ name: "px-flow-devjc", installed: true }, { name: "homelab", installed: false }],
  },
  {
    name: "gox", source: "goxtechnologies/marketplace", visibility: "org", mine: true,
    plugins: [{ name: "pulsatrix-flow-gox", installed: true }],
  },
  {
    name: "pulsatrix", source: "pulsatrixtechnologies/marketplace", visibility: "org", mine: false,
    plugins: [{ name: "pulsatrix-flow", installed: true }],
  },
];

function Preview() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <MarketplacesSection
        marketplaces={marketplaces}
        busy={null}
        error={null}
        canChooseVisibility
        onAdd={async () => true}
        onRefresh={() => {}}
        onRemove={() => {}}
        onSetVisibility={() => {}}
      />
    </main>
  );
}

applySkin(readSkin());
createRoot(document.getElementById("root")!).render(<Preview />);
