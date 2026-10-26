/** Isolated gallery for Playwright screenshots of dropdowns inside clipping
 * containers (overflow hidden / auto) and near the window edges: they must
 * float over the container, flip and stay on screen. Not shipped in the app.
 * ?skin=<id>&lang=<code> */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { PillSelect, CompactRow } from "../components/SettingsPrimitives";
import { ComputerMoreMenu } from "../components/computer/ComputerMoreMenu";
import { setLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "en");

type Level = "use" | "run" | "edit" | "manage";
const LEVELS = (): Array<{ value: Level; label: string }> => [
  { value: "use", label: t("botSettings.sharing.level.use") },
  { value: "run", label: t("botSettings.sharing.level.run") },
  { value: "edit", label: t("botSettings.sharing.level.edit") },
  { value: "manage", label: t("botSettings.sharing.level.manage") },
];

function Level({ label }: { label: string }) {
  const [value, setValue] = useState<Level>("use");
  return <PillSelect<Level> value={value} options={LEVELS()} onChange={setValue} ariaLabel={`${t("botSettings.sharing.level")} · ${label}`} />;
}

function Gallery() {
  return (
    <div className="min-h-dvh bg-app p-6 text-ink">
      <div className="grid max-w-[560px] gap-6">
        <section data-case="clipped-card" className="overflow-hidden rounded-xl border-[0.5px] border-border bg-elevated">
          <CompactRow label="Marie Tremblay"><Level label="Marie Tremblay" /></CompactRow>
        </section>
        <section data-case="scroll-area" className="h-[120px] overflow-y-auto rounded-xl border-[0.5px] border-border bg-elevated">
          {["Alex", "Sam", "Jo", "Lee", "Max"].map((name) => (
            <CompactRow key={name} label={name}><Level label={name} /></CompactRow>
          ))}
        </section>
        <section data-case="more-menu" className="overflow-hidden rounded-xl border-[0.5px] border-border bg-elevated p-2">
          <div className="flex justify-end">
            <ComputerMoreMenu items={[
              { id: "two", icon: null, label: "Open two desktops", onSelect: () => {} },
              { id: "sleep", icon: null, label: "Sleep", onSelect: () => {} },
              { id: "delete", icon: null, label: "Delete the VM", danger: true, onSelect: () => {} },
            ]} />
          </div>
        </section>
      </div>
      <div data-case="corner" className="fixed bottom-2 right-2 overflow-hidden"><Level label="corner" /></div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
