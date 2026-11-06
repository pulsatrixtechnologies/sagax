// Where a bot's turns run: the organization server, or one computer the
// signed-in person registered. A computer only answers while it is on.
import { useEffect, useState } from "react";
import { canSetBotHost } from "@/lib/bot-capabilities";
import { t } from "@/lib/i18n";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { api, useStore, type Bot } from "@/state/store";
import { readableError } from "@/lib/plain-error";
import { PillSelect } from "../SettingsPrimitives";

export interface PublishedComputer {
  deviceId: string;
  name: string;
  online: boolean;
  engines: { instanceId: string; label: string; driverKind?: string; models: { id: string; label: string }[] }[];
}

export function BotHostForm({
  host,
  workers,
  canEdit,
  model,
  onFleet,
  onMachine,
  onModel,
}: {
  host?: Bot["host"];
  workers: readonly PublishedComputer[];
  canEdit: boolean;
  model?: { instanceId: string; model: string };
  onFleet: () => void;
  onMachine: (deviceId: string) => void;
  onModel: (instanceId: string, model: string) => void;
}) {
  const machineId = host?.kind === "machine" ? host.deviceId : null;
  const computer = workers.find((worker) => worker.deviceId === machineId);
  const options = (computer?.engines ?? []).flatMap((engine) => engine.models.map((option) => ({
    key: `${engine.instanceId}\u0000${option.id}`,
    instanceId: engine.instanceId,
    model: option.id,
    label: `${engine.label} · ${option.label || option.id}`,
  })));
  return (
    <div className="px-3.5 py-2.5" data-bot-host-row="">
      <div className="text-[13px] leading-[18px] text-ink">{t("botPanel.model.where")}</div>
      {/* "only while this computer is on" is true of a computer, never of the organization server */}
      <p className="mt-0.5 text-[12px] leading-4 text-ink-secondary" data-bot-host-help={machineId ? "machine" : "fleet"}>{t(machineId ? "botPanel.model.whereHelp" : "botPanel.model.whereHelpServer")}</p>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t("botPanel.model.where")}>
        <button
          type="button"
          data-bot-host="fleet"
          aria-pressed={!machineId}
          disabled={!canEdit}
          onClick={onFleet}
          className="ui-button"
        >
          {t("botPanel.model.hostServer")}
        </button>
        {workers.map((worker) => (
          <button
            key={worker.deviceId}
            type="button"
            data-bot-host={worker.deviceId}
            aria-pressed={machineId === worker.deviceId}
            disabled={!canEdit}
            onClick={() => onMachine(worker.deviceId)}
            className="ui-button"
          >
            {t("botPanel.model.hostComputer", { name: worker.name })}{worker.online ? "" : ` (${t("botPanel.model.hostOffline")})`}
          </button>
        ))}
      </div>
      {machineId && workers.length === 0 && (
        <p className="mt-2 text-[12px] leading-4 text-ink-secondary">{t("botPanel.model.hostNoComputer")}</p>
      )}
      {machineId && options.length > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 text-[13px] leading-[18px] text-ink" data-bot-host-model="">
          {t("botPanel.model.hostEngines")}
          <PillSelect
            ariaLabel={t("botPanel.model.hostEngines")}
            disabled={!canEdit}
            value={options.some((option) => option.instanceId === model?.instanceId && option.model === model?.model) ? `${model?.instanceId}\u0000${model?.model}` : options[0]!.key}
            onChange={(next) => {
              const [instanceId, modelId] = next.split("\u0000");
              if (instanceId && modelId) onModel(instanceId, modelId);
            }}
            options={options.map((option) => ({ value: option.key, label: option.label }))}
          />
        </div>
      )}
    </div>
  );
}

export function BotHostSettings({ bot }: { bot: Bot }) {
  const org = usePerspicaxOrg();
  const { state } = useStore();
  const [workers, setWorkers] = useState<PublishedComputer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const canEdit = canSetBotHost(state.config, bot);
  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    void api<{ workers?: PublishedComputer[] }>("/api/workers").then((body) => {
      if (!cancelled) setWorkers(Array.isArray(body.workers) ? body.workers : []);
    }).catch(() => {
      if (!cancelled) setWorkers([]);
    });
    return () => { cancelled = true; };
  }, [org, bot.host?.kind === "machine" ? bot.host.deviceId : ""]);
  if (!org) return null;
  const save = async (host: unknown) => {
    setError(null);
    try {
      await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ host }) });
    } catch (caught) {
      setError(readableError(caught));
    }
  };
  const machine = bot.host?.kind === "machine" ? bot.host.deviceId : null;
  return (
    <>
      <BotHostForm
        host={bot.host}
        workers={workers}
        canEdit={canEdit}
        model={bot.modelSelection}
        onFleet={() => { if (bot.host?.kind === "machine") void save("fleet"); }}
        onMachine={(deviceId) => {
          if (deviceId === machine) return;
          const computer = workers.find((worker) => worker.deviceId === deviceId);
          const engine = computer?.engines[0];
          const model = engine?.models[0];
          if (!engine || !model) {
            setError(t("botPanel.model.hostNoComputer"));
            return;
          }
          void save({ kind: "machine", deviceId, model: { instanceId: engine.instanceId, model: model.id } });
        }}
        onModel={(instanceId, model) => {
          if (!machine) return;
          void save({ kind: "machine", deviceId: machine, model: { instanceId, model } });
        }}
      />
      {error && <p className="px-3.5 pb-2 text-[12px] leading-4 text-danger" role="alert">{error}</p>}
    </>
  );
}
