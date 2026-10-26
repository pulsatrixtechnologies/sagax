// Isolated preview of Settings > Computer > Computer care's Update / Recover
// row with the working-bots list and Stop buttons, plus the Reset row. Used
// for headless screenshots (busy with two bots, idle, both themes); no real
// /api is reached, the status and the working-bots list are injected.
//   ?state=busy|idle   ?theme=dark|light
import { createRoot } from "react-dom/client";

import { ComputerRecoverRow } from "../../src/components/settings/ComputerRecoverRow";
import type { WorkingBot } from "../../src/lib/computer-working-bots";
import { SettingsGroup } from "../../src/components/SettingsPrimitives";
import { applySkin } from "../../src/lib/skins";
import { t } from "../../src/lib/i18n";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
applySkin(params.get("theme") === "light" ? "atelier" : "midnight");
const busy = params.get("state") === "busy";
const workers: WorkingBot[] = busy
  ? [
      { id: "bot-9f2c-katarina", name: "Katarina", threadId: "thr-1" },
      { id: "bot-3a71-ember", name: "Ember", threadId: "thr-2" },
    ]
  : [];

const root = createRoot(document.getElementById("root")!);
root.render(
  <div className="mx-auto max-w-[560px] p-6">
    <SettingsGroup title={t("computerCare.title")} groupId="computerCare">
      <ComputerRecoverRow
        initial={{ configured: true, state: "running" }}
        confirm={async () => false}
        loadWorkingBotsFn={async () => workers}
        stopWorkingBotFn={async () => {}}
        pollMs={1_000_000}
      />
    </SettingsGroup>
  </div>,
);
