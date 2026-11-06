// Settings > Organization > Memory (#2080 L3): one row (state in grey) and
// Open (the full Memory page). Retry, Open in Obsidian and Show folder sit
// in the row's ⋯ menu.
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { activeLocale, t } from "@/lib/i18n";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import {
  orgMemoryStatus,
  refusedCount,
  runOrgMemoryAuto,
  tiersNeedingAttention,
  useOrgMemoryState,
  type OrgMemoryAutoError,
  type OrgMemoryBridge,
  type OrgMemoryOpenResult,
  type OrgMemoryState,
} from "@/lib/org-memory";
import type { LocaleKey } from "@/locales";
import { useStore } from "@/state/store";
import { DescribedRow, PILL } from "./SettingsPrimitives";

type OpenProblem = "not_installed" | "add_vault" | "failed";
const OPEN_KEY: Record<OpenProblem, LocaleKey> = {
  not_installed: "settings.memory.obsidianMissing",
  add_vault: "settings.memory.obsidianAddVault",
  failed: "settings.memory.openFailed",
};

function openProblem(result: OrgMemoryOpenResult): OpenProblem | null {
  if (result === true || result.ok) return null;
  return result.reason in OPEN_KEY ? result.reason : "failed";
}

const ERROR_KEY: Record<OrgMemoryAutoError, LocaleKey> = {
  unreachable: "settings.memory.error.unreachable",
  unsupported: "settings.memory.error.unsupported",
  memory_off: "settings.memory.error.memoryOff",
  not_member: "settings.memory.error.notMember",
  signed_out: "settings.memory.error.signedOut",
  no_org: "settings.memory.error.noOrg",
  cloud_folder: "settings.memory.error.cloudFolder",
};

export function OrgMemorySettings() {
  const bridge = typeof window === "undefined" ? undefined : window.ogb?.orgMemory;
  const org = usePerspicaxOrg();
  if (!bridge) {
    return (
      <div data-settings-card="organization.memory">
        <DescribedRow label={t("organization.memory.row")} rowId="memory" description={t("settings.memory.desktopOnly")} />
      </div>
    );
  }
  return <OrgMemoryPanel bridge={bridge} orgName={org?.org.name ?? null} />;
}

export function OrgMemoryPanel({ bridge, orgName, initial = null, initialOpenProblem = null }: { bridge: OrgMemoryBridge; orgName: string | null; initial?: OrgMemoryState | null; initialOpenProblem?: OpenProblem | null }) {
  const { dispatch } = useStore();
  const { state, running } = useOrgMemoryState(bridge, initial);
  const [opening, setOpening] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [problem, setProblem] = useState<OpenProblem | null>(initialOpenProblem);
  const status = orgMemoryStatus(state, running);
  const attention = tiersNeedingAttention(state).length;
  const refused = refusedCount(state?.pending ?? []);
  const errorKey = state?.autoError ? ERROR_KEY[state.autoError] ?? ERROR_KEY.unreachable : null;
  const pending = state?.pendingCount ?? 0;

  const when = state?.lastSyncAt
    ? t("settings.memory.lastSync", { when: new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.lastSyncAt)) })
    : t("settings.memory.neverSynced");
  const description = status === "syncing"
    ? t("settings.memory.syncing")
    : status === "setting-up"
      ? t("settings.memory.settingUp")
      : status === "failed" && errorKey
        ? <span role="alert" className="text-warning">{t(errorKey)}</span>
        : pending > 0
          ? t("settings.memory.pendingCount", { count: String(pending) })
          : attention > 0 || refused > 0
            ? [
                attention > 0 ? t("settings.memory.attentionCount", { count: String(attention) }) : null,
                refused > 0 ? t("settings.memory.refusedCount", { count: String(refused) }) : null,
              ].filter(Boolean).join(" · ")
            : state?.connected
              ? when
              : t("settings.memory.settingUp");

  const openInObsidian = async () => {
    setOpening(true);
    setProblem(null);
    setMenuOpen(false);
    try {
      setProblem(openProblem(await bridge.openInObsidian()));
    } catch {
      setProblem("failed");
    } finally {
      setOpening(false);
    }
  };

  return (
    <div data-settings-card="organization.memory" data-org-memory={status}>
      <DescribedRow
        label={t("organization.memory.row")}
        rowId="memory"
        description={description}
        below={(
          <>
            {state?.cloudFolder && <p role="alert" className="mt-1.5 text-[12px] text-danger">{t("settings.memory.cloudFolder", { place: state.cloudFolder })}</p>}
            {state?.lastError && !state.autoError && <p role="alert" className="mt-1.5 text-[12px] text-warning">{state.lastError}</p>}
            {problem && <p role="alert" className="mt-1.5 text-[12px] text-danger">{t(OPEN_KEY[problem])}</p>}
            {menuOpen && (
              <div className="mt-2 flex flex-wrap gap-2" data-memory-menu="">
                {status === "failed" && (
                  <button type="button" className={PILL} disabled={running} onClick={() => { setMenuOpen(false); void runOrgMemoryAuto(bridge); }}>
                    {t("settings.memory.retry")}
                  </button>
                )}
                {state?.cloned && (
                  <button type="button" className={PILL} disabled={opening} onClick={() => void openInObsidian()}>
                    {t("settings.memory.openInObsidian")}
                  </button>
                )}
                {state?.cloned && typeof bridge.showFolder === "function" && (
                  <button type="button" className={PILL} onClick={() => { setMenuOpen(false); void bridge.showFolder().catch(() => false); }}>
                    {t("settings.memory.showFolder")}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      >
        <button
          type="button"
          className={PILL}
          aria-label={t("organization.memory.menu")}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((value) => !value)}
        >
          <MoreHorizontal size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={PILL}
          onClick={() => dispatch({ type: "toggleMemoryManager", open: true })}
        >
          {t("organization.memory.open")}
        </button>
      </DescribedRow>
    </div>
  );
}
