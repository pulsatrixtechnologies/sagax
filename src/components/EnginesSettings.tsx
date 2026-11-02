// Engines settings: per-instance CLI path override. One "Set CLI…" button
// per engine reveals a picker: a "detected" dropdown of every binary the
// server found on PATH, plus a manual path input. Saving first probes the
// binary (`<cli> --version`, same PATH a real turn uses); a failed probe
// asks before registering: the classic miss is a path the terminal sees
// but this GUI app can't.
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Phone, RefreshCw, TriangleAlert } from "lucide-react";

import { api, useStore, type ConfigStatus, type InstanceInfo } from "@/state/store";
import { EngineCard, engineReady } from "./EngineLibrary";
import { cn } from "@/lib/cn";
import { useMenuMotion } from "./MenuMotion";
import { t } from "@/lib/i18n";
import { ApiKeyEngineManage, EngineSetup, EngineUpdateNotice, EngineWarningNotice } from "./EngineSetup";
import { AddClaudeAccount, ClaudeAccountSettings } from "./ClaudeAccountSettings";
import { AddProviderAccount, CodexAccountSettings } from "./CodexAccountSettings";
import { DEVICE_SIGN_IN_COPY, deviceSignInProvider } from "./DeviceSignIn";
import { AntigravityFreeSpace } from "./AntigravityFreeSpace";
import { EngineConnect, paysWithText } from "./EngineConnect";
import { EngineConnectorsLine } from "./plugins/EngineCapabilities";
import { reloadMyEngines, usePerspicaxOrg, type MyEngine } from "@/lib/perspicax-org";
import { myTurnsReady } from "../../shared/org-engine-readiness";
import { canEditConfig, canManageKeys, viewerCan, viewerIsOrgMember } from "@/lib/viewer";
import { viewerIsOrgAdmin } from "@/lib/group-owner";
import { boatComputerEnabled, vpsComputerEnabled } from "@/lib/feature-flags";
import { OrgHostToolsNote, orgRefusesEngine } from "./OrgHostToolsNote";
import { DescribedRow, FIELD, FoldRow, PILL, PillSelect, SettingsGroup } from "./SettingsPrimitives";
import { ProviderKeyDialog } from "./settings/ProviderKeys";
import { AutoModelSettings } from "./settings/AutoModelSettings";
import { BotModelsSettings } from "./settings/BotModelsSettings";
import { CacheKeepWarmSettings } from "./CacheKeepWarmSettings";
import { ModelSwitchesSettings } from "./settings/ModelSwitchesSettings";
import { VoiceProviderSettings } from "./settings/VoiceProviderSettings";
import { WebSearchSettings } from "./settings/WebSearchSettings";
import { VoiceProviderOptions } from "./settings/VoiceProviderOptions";
import { MicrophonePermissionRow, MicrophoneSettings } from "./settings/MicrophoneSettings";
import { ImageGenerationSettings } from "./settings/ImageGenerationSettings";
import { LiveCallInstallationSettings } from "./LiveCallSettings";
import { ApiKeyRow, VpsConnection } from "./ApiKeys";
import { useViewAsMember } from "@/lib/view-as-member";

interface ProbeResult {
  ok: boolean;
  version?: string;
  message?: string;
}

function CustomPicker({ instance, cliDefault, onClose, onSaved }: {
  instance: InstanceInfo;
  cliDefault?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [candidates, setCandidates] = useState<string[] | null>(instance.cliCandidates ?? null);
  // `selected` starts EMPTY, never at instance.cli: a wrapper override
  // ("/ag claude agp") has no matching <option>, and a select whose value
  // points at a missing option renders the placeholder while still holding
  // the ghost value: the form would look empty yet refuse to save.
  const [selected, setSelected] = useState<string>("");
  const [manual, setManual] = useState<string>(
    // the current override rides the manual input unless it is exactly a
    // detected path (then the dropdown preselects it below)
    instance.cli && !(instance.cliCandidates ?? []).includes(instance.cli) ? instance.cli : "",
  );
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  // The describe() snapshot can be stale (CLI installed since last refresh);
  // re-fetch candidates once when the picker mounts so the dropdown is current.
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    api(`/api/cli-candidates?name=${encodeURIComponent(cliDefault ?? "")}`)
      .then(({ candidates: found }: { candidates: string[] }) => {
        setCandidates(found);
        if (!instance.cli) return;
        // preselect a detected override in the dropdown; a non-detected one
        // (wrapper string, moved binary) rides the manual input instead
        if (found.includes(instance.cli)) setSelected(instance.cli);
        else setManual(instance.cli);
      })
      .catch(() => setCandidates((prev) => prev ?? []));
  }, [cliDefault, instance.cli]);

  const value = manual.trim() || selected;
  const dirty = value !== (instance.cli ?? "");
  const busy = probing || saving;

  // Editing the path invalidates a previous probe result.
  useEffect(() => {
    setProbe(null);
  }, [value]);

  const persist = () => {
    if (busy || !value || !dirty) return;
    setSaving(true);
    setError(null);
    const committed = value; // freeze: inputs disable during save, but the
    // closure must not see a later keystroke either
    api(`/api/instances/${encodeURIComponent(instance.instanceId)}`, {
      method: "PATCH",
      body: JSON.stringify({ cli: committed }),
    })
      // onSaved (refreshInstances) failing must NOT read as "not saved":
      // the PATCH already returned 200. Close regardless; the global banner
      // from refreshInstances already reports the refresh failure.
      .then(() => Promise.resolve(onSaved()).catch(() => {}))
      .then(onClose)
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  };

  const save = () => {
    if (busy || !value || !dirty) return;
    setProbing(true);
    setError(null);
    api("/api/cli-test", {
      method: "POST",
      body: JSON.stringify({ cli: value, driver: instance.driverKind }),
    })
      .then((result: ProbeResult) => {
        setProbe(result);
        // ok → save immediately; failed → hold for explicit confirmation
        if (result.ok) persist();
      })
      .catch((e) => setError(e.message))
      .finally(() => setProbing(false));
  };

  return (
    <div className="mt-2.5 flex flex-col gap-2">
      {candidates !== null && candidates.length > 0 && (
        <div className="flex">
          <PillSelect
            value={manual.trim() ? "" : selected}
            onChange={(next) => {
              setSelected(next);
              setManual("");
            }}
            ariaLabel={t("engines.detectedAria", { name: instance.displayName })}
            disabled={busy}
            options={[{ value: "", label: t("engines.selectBinary") }, ...candidates.map((p) => ({ value: p, label: p }))]}
          />
        </div>
      )}
      <input
        type="text"
        value={manual}
        onChange={(e) => setManual(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (!value || !dirty) return; // nothing to save: same hint the disabled button gives
          save();
        }}
        placeholder={candidates?.length ? t("engines.manualPath") : "/absolute/path/to/cli"}
        aria-label={t("engines.customAria", { name: instance.displayName })}
        spellCheck={false}
        disabled={busy}
        className={cn(FIELD, "font-mono text-[12px] placeholder:font-sans")}
      />
      {probe && !probe.ok && probe.message && (
        <div role="alert" className="flex gap-1.5 text-[12px] leading-4 text-warning">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          <span>{t("engines.testFailed", { message: probe.message })}</span>
        </div>
      )}
      {probe?.ok && probe.version && (
        <div className="text-[12px] text-success">{t("engines.testPassed", { version: probe.version })}</div>
      )}
      {error && <div role="alert" className="text-[12px] text-danger">{error}</div>}
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className={PILL}
        >
          {t("common.cancel")}
        </button>
        {probe && !probe.ok ? (
          <>
            <button
              onClick={() => setProbe(null)}
              disabled={busy}
              className={PILL}
            >
              {t("engines.editPath")}
            </button>
            <button
              onClick={() => persist()}
              disabled={busy}
              className={`${PILL} inline-flex items-center gap-1.5 text-danger`}
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : t("engines.saveAnyway")}
            </button>
          </>
        ) : (
          <button
            onClick={save}
            disabled={busy || !value || !dirty}
            className={`${PILL} inline-flex items-center gap-1.5`}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <><Check size={13} />{t("common.save")}</>}
          </button>
        )}
      </div>
    </div>
  );
}

/** On an organization server, which engine cards to list: never one whose
 * CLI is not installed on the server. */
export function orgEngineRows(instances: InstanceInfo[], mine: readonly MyEngine[] | null): InstanceInfo[] {
  if (!mine) return instances;
  return instances.filter((instance) => mine.find((engine) => engine.instanceId === instance.instanceId)?.installed !== false);
}

/** 2026-10-30: the card's line for a person's own access: what pays, and
 * "Allowed through your own account" for an engine outside the
 * organization's list that their own subscription or key runs (listed only
 * when the organization lets own accounts through). Never ready on an
 * expired sign-in. */
export function personalEngineLine(mine: MyEngine): { ready: boolean; line: string; turns: string } {
  const ready = myTurnsReady(mine);
  const line = paysWithText(mine);
  return { ready, line: ready && mine.orgNotAllowed === true ? `${line} · ${t("engines.ownAccountOnly")}` : line, turns: mine.myTurns };
}

/** `mine`: on an organization server, the signed-in person's own access to
 * this engine. The card then shows one line on what pays for their turns and
 * their own Connect or Disconnect (EngineConnect), never the server's account
 * (which serves no one's turns there: server/engine-credentials.ts). */
export function EngineRow({ instance, mine, member = false, issuer = "", bare = false, keysManaged = false }: { instance: InstanceInfo; mine?: MyEngine; member?: boolean; issuer?: string; bare?: boolean; keysManaged?: boolean }) {
  const { refreshInstances } = useStore();
  const [open, setOpen] = useState(false);
  const cliMotion = useMenuMotion(open);
  const [switching, setSwitching] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updatedVersion, setUpdatedVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wasOpenFor = useRef<string | null>(null);

  // Close the picker when this instance's override changes to anything else
  // (a save from this row, another tab, or the 5-min refresh. The picker
  // initialized its fields from the OLD value and never re-syncs, so staying
  // open would show stale state.
  useEffect(() => {
    if (wasOpenFor.current !== null && wasOpenFor.current !== instance.cli) {
      setOpen(false);
    }
    wasOpenFor.current = instance.cli ?? null;
  }, [instance.cli]);

  const reset = () => {
    if (switching || updating) return;
    setSwitching(true);
    setError(null);
    api(`/api/instances/${encodeURIComponent(instance.instanceId)}`, {
      method: "PATCH",
      body: JSON.stringify({ cli: "" }),
    })
      // The reset already succeeded once PATCH returns 200. A follow-up list
      // refresh failure should not tell the user the reset itself failed.
      .then(() => Promise.resolve(refreshInstances()).catch(() => {}))
      .catch((e) => setError(e.message))
      .finally(() => setSwitching(false));
  };

  const updateClaude = () => {
    if (switching || updating) return;
    setUpdating(true);
    setUpdatedVersion(null);
    setError(null);
    api(`/api/instances/${encodeURIComponent(instance.instanceId)}/claude-update`, {
      method: "POST",
      body: JSON.stringify({}),
    })
      .then(async ({ version }: { version: string }) => {
        setUpdatedVersion(version);
        await Promise.resolve(refreshInstances()).catch(() => {});
      })
      .catch((e) => setError(e.message))
      .finally(() => setUpdating(false));
  };

  const policyNote = instance.policy && <p className="mb-2 text-[12px] leading-relaxed text-ink-secondary">
    <span className="font-medium text-ink">{t("policy.managedBy", { organization: instance.policy.organizationName })}</span> · {instance.policy.reason}
  </p>;
  // An organization member: their own access only. The server's engine
  // (its CLI and its updates) is the admins' to change.
  // On an organization server an engine whose own tools cannot be held back
  // never runs a turn there (409 host_tools); its card says why.
  const hostToolsNote = (member || mine !== undefined) && orgRefusesEngine(instance) && <OrgHostToolsNote instance={instance} className="mb-3 text-[12px]" />;
  if (member && mine) return (
    <EngineCard instance={instance} personal={personalEngineLine(mine)} bare={bare}>
      {policyNote}
      {hostToolsNote}
      <div data-member-engine={instance.instanceId}><EngineConnect engine={mine} issuer={issuer} onChanged={reloadMyEngines} statusLine={false} keysManaged={keysManaged} /></div>
    </EngineCard>
  );
  if (instance.readOnly) return <EngineCard instance={instance} bare={bare}>
    {policyNote}
    <p className="text-[13px] leading-relaxed text-ink-secondary">{t("organization.managedEngine")}</p>
    {!engineReady(instance) && <p className="mt-2 text-[12px] text-ink-secondary">{t("organization.engineUnavailable")}</p>}
  </EngineCard>;

  return (
    <EngineCard instance={instance} personal={mine && personalEngineLine(mine)} bare={bare}>
      {policyNote}
      {hostToolsNote}
      {mine && <EngineConnect engine={mine} issuer={issuer} onChanged={reloadMyEngines} className="mb-3" statusLine={false} keysManaged={keysManaged} />}
      {!mine && !engineReady(instance) && <EngineSetup instance={instance} intent={instance.access === "custom" ? "inject" : "cloud"} unframed keysManaged={keysManaged} />}
      {!mine && !keysManaged && engineReady(instance) && <ApiKeyEngineManage instance={instance} className="mt-3" />}
      {instance.snapshot.update && <EngineUpdateNotice update={instance.snapshot.update} instance={instance} className="mt-3" />}
      {instance.snapshot.warning && <EngineWarningNotice warning={instance.snapshot.warning} className="mt-3" />}
      {engineReady(instance) && <EngineConnectorsLine driverKind={instance.driverKind} />}
      {!mine && instance.claudeAccount && <ClaudeAccountSettings instance={instance} />}
      {!mine && engineReady(instance) && instance.snapshot.authenticated === true && (
        (instance.authentication?.method === "device-code" || instance.authentication?.method === "browser-pkce") && deviceSignInProvider(instance.driverKind) === "codex"
          ? <CodexAccountSettings instance={instance} />
          : instance.authentication?.method === "device-code"
          ? <p className="flex items-center gap-1.5 text-[12px] text-success"><Check size={13} />{t(DEVICE_SIGN_IN_COPY[deviceSignInProvider(instance.driverKind)].connectedAccount)}</p>
          : instance.authentication?.method === "open-link"
          ? <p className="flex items-center gap-1.5 text-[12px] text-success"><Check size={13} />{t(DEVICE_SIGN_IN_COPY.cursor.connectedAccount)}</p>
          : instance.authentication?.method === "paste-code" && !instance.claudeAccount && (
            <p className="flex items-center gap-1.5 text-[12px] text-success"><Check size={13} />{t("engineSetup.claude.connectedAccount")}</p>
          )
      )}
      {instance.freeUpSpace && <AntigravityFreeSpace instance={instance} />}
      {!member && instance.driverKind === "antigravityAgent" && (
        <div className="mt-3 space-y-3">
          {instance.snapshot.authenticated && <p className="break-words text-[12px] text-ink-secondary">{instance.snapshot.account?.email ?? t("engineSetup.antigravity.emailUnavailable")}</p>}
          <AddProviderAccount antigravityInstanceId={instance.instanceId} />
        </div>
      )}
      {!member && instance.driverKind === "claudeAgent" && instance.access !== "custom" && (
        <div className="mt-3"><AddClaudeAccount /></div>
      )}
      {!member && instance.snapshot.chatgptPlan && !instance.snapshot.authenticationUnavailableReason && (
        <div className="mt-3"><AddProviderAccount /></div>
      )}
      <details className="mt-4 border-t border-hairline/40 pt-3">
        <summary className="cursor-pointer rounded-md py-1 text-[12px] font-medium text-ink-secondary outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent">{t("engines.library.advanced")}</summary>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("engines.footer")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
          {instance.cli ? (
            <span className="w-full break-all font-mono text-[11.5px] text-ink-secondary" title={instance.cli}>
              {instance.cli}
            </span>
          ) : (
            instance.cliDefault && (
              <span className="break-all font-mono text-[11px] text-ink-secondary">{instance.cliDefault}</span>
            )
          )}
          {instance.snapshot.version && (
            <span className="break-all text-[11px] text-ink-secondary" title={instance.snapshot.version}>
              {instance.snapshot.version}
            </span>
          )}
          <span className="flex-1" />
          {instance.driverKind === "claudeAgent" && !instance.pinned && (
            <button
              onClick={updateClaude}
              disabled={switching || updating}
              className="flex shrink-0 items-center gap-1 text-[11.5px] text-ink-secondary hover:text-ink disabled:opacity-50"
            >
              {updating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {updating ? t("engines.updating") : t("engines.updateClaude")}
            </button>
          )}
          {instance.cli && (
            <button
              onClick={reset}
              disabled={switching || updating}
              className="shrink-0 text-[11.5px] text-ink-secondary hover:text-ink disabled:opacity-50"
            >
              {switching ? t("engines.resetting") : t("engines.reset")}
            </button>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            disabled={updating}
            aria-expanded={open}
            className={cn(
              "shrink-0 rounded-lg border border-hairline/40 px-3 py-1 text-[12px]",
              open ? "bg-accent/15 text-accent" : "text-ink-secondary hover:bg-raised/50 hover:text-ink",
              "disabled:opacity-50",
            )}
          >
            {t("engines.setCli")}
          </button>
        </div>
        {updatedVersion && (
          <div role="status" className="mt-1 text-[12px] text-success">{t("engines.claudeUpdated", { version: updatedVersion })}</div>
        )}
        {error && <div role="alert" className="mt-1 text-[12px] text-danger">{error}</div>}
        {cliMotion.shown && (
          <div className={cliMotion.className} {...cliMotion.exitProps}>
            <CustomPicker
              instance={instance}
              cliDefault={instance.cliDefault}
              onClose={() => setOpen(false)}
              onSaved={refreshInstances}
            />
          </div>
        )}
      </details>
    </EngineCard>
  );
}

/** In an organization, keys are for an owner, an admin, the server's
 * operator, or a member whose profile includes engines.manage (the maintainer,
 * 2026-10-16: as before). Elsewhere whoever may manage the installation's
 * keys. Never in a remote window, where the key store is not this
 * server's. */
export function keysShown(input: { member: boolean; remote: boolean; organization: boolean; config: ConfigStatus | null | undefined }): boolean {
  if (input.member || input.remote) return false;
  const viewer = input.config?.viewer;
  // an older server names no viewer: the screen it had
  if (!input.organization || !viewer) return canManageKeys(input.config);
  return viewer.operator || viewerIsOrgAdmin(input.config) || viewerCan(input.config, "engines.manage");
}

/** Who sees what on Models and Voice: a member's view of the engines, the
 * Keys list, and the installation's own settings (the voice engine, image
 * generation, online computers). Shared by both pages (2026-10-28), so the
 * split changes no right. */
export function useModelsVoiceAccess() {
  const { state } = useStore();
  const org = usePerspicaxOrg();
  // 2026-10-30: an admin's "View as a member" (Settings > Providers) draws
  // these pages as a member reads them; it changes no right
  const asMember = useViewAsMember() && org !== null;
  const member = asMember || (viewerIsOrgMember(state.config) && !viewerCan(state.config, "engines.manage"));
  const remote = typeof window !== "undefined" && window.ogb?.remoteClient?.active === true;
  const keys = keysShown({ member, remote, organization: org !== null || viewerIsOrgMember(state.config), config: state.config });
  // The voice engine, image generation and online computers write the
  // installation too: shown to whoever may change it.
  const installation = !member && canEditConfig(state.config);
  const personalVoiceKeys = org !== null || viewerIsOrgMember(state.config);
  return { member, org, keys, installation, personalVoiceKeys };
}

/** Settings > Models: Auto, active models, web search, image generation
 * and the optional computers. Accounts and keys live in Providers. */
export function EnginesSettings() {
  const { state } = useStore();
  const { keys, installation } = useModelsVoiceAccess();

  return (
    <div className="flex min-w-0 flex-col gap-6 pb-2" data-models-voice="" data-models-page="">
      {/* #1675: Bot models first (defaults + table + bulk), then Auto and switches */}
      <BotModelsSettings />
      <ProvidersMovedNotice />
      <ModelSwitchesSettings />
      {installation && <CacheKeepWarmSettings />}
      {/* the person's own web search provider and key: theirs, no admin right */}
      <WebSearchSettings />
      {installation && (
        <div data-settings-card="connections.image">
          <SettingsGroup title={t("imageGen.title")} groupId="image">
            <ImageGenerationSettings keysLink={keys} />
          </SettingsGroup>
        </div>
      )}
      {installation && (boatComputerEnabled(state.config) || vpsComputerEnabled(state.config)) && (
        <div data-settings-card="connections.integrations">
          <SettingsGroup title={t("keys.integrations.title")} groupId="integrations">
            <div className="flex flex-col gap-4 px-3.5 py-2.5">
              {boatComputerEnabled(state.config) && <ApiKeyRow section="box" />}
              {vpsComputerEnabled(state.config) && <VpsConnection />}
            </div>
          </SettingsGroup>
        </div>
      )}
      {(keys || installation) && <ProviderKeyDialog />}
    </div>
  );
}

/** The person's unified providers and voices, microphone, provider options
 * and installation Live controls. Personal keys live in Providers. */
export function VoiceSettingsPage() {
  const { installation } = useModelsVoiceAccess();
  return (
    <div className="flex min-w-0 flex-col gap-6 pb-2" data-voice-page="">
      <VoiceProviderSettings />
      <VoiceProviderOptions installation={installation} />
      {/* this computer's microphone: everyone's, whoever edits the installation */}
      <div data-settings-card="connections.audio">
        <SettingsGroup title={t("settings.audio.title")} groupId="audio">
          <MicrophonePermissionRow />
          <MicrophoneSettings />
        </SettingsGroup>
      </div>
      {installation && <VoiceSection />}
    </div>
  );
}

/** Auto and the one link to accounts, keys and compatible servers. */
function ProvidersMovedNotice() {
  const { dispatch } = useStore();
  return (
    <SettingsGroup title={t("engines.title")} groupId="models-auto">
      <div data-auto-model-explainer=""><AutoModelSettings /></div>
      <DescribedRow label={t("providers.moved.title")} description={t("providers.moved.body")} rowId="providers-moved">
        <button type="button" data-open-providers="" className={PILL}
          onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "providers" })}>
          {t("providers.moved.open")}
        </button>
      </DescribedRow>
    </SettingsGroup>
  );
}

/** Live call installation controls stay folded and preserve their values. */
function VoiceSection() {
  return (
    <div data-settings-card="connections.voice" data-voice-section="">
      <SettingsGroup title={t("modelsVoice.voice.title")} groupId="voice">
        <FoldRow cardId="voice.advanced" label={t("voice.live.title")} icon={<Phone size={14} />}>
          <div data-voice-advanced="">
            <LiveCallInstallationSettings />
          </div>
        </FoldRow>
      </SettingsGroup>
    </div>
  );
}
