// The model picker on an organization server (Perspicax): the person's own
// access to the engine being browsed, the same minimal card as Settings >
// Model providers (EngineConnect), less what the window says elsewhere: what
// pays today sits under the engine's name and Disconnect on the provider's
// row (2026-10-15), so the card shows only while there is something to do
// (Connect, or the link to the person's keys).
// The payer order is the server's (src/lib/model-payers.ts,
// server/engines/engine-credentials.ts) and is not drawn as a list. The server's own
// engine login is an admin setting in Settings and never signed in from here.
import { t } from "@/lib/i18n";
import type { MyEngine } from "@/lib/perspicax-org";
import { EngineConnect, engineConnectHasAction } from "./EngineConnect";

export function ModelPickerPayers({ engine, issuer, routine = false, onChanged }: {
  engine: MyEngine;
  issuer: string;
  /** A routine thread: its turns pay as the bot's owner, not the viewer. */
  routine?: boolean;
  /** Reload the person's engines after a sign-in or sign-out. */
  onChanged: () => Promise<unknown> | void;
}) {
  if (routine) return (
    <section data-model-payers data-model-payers-routine className="rounded-xl border border-hairline/40 bg-control/30 p-3">
      <h3 className="text-[12.5px] font-semibold text-ink">{t("turnAccess.ownerCredentials")}</h3>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-secondary">{t("model.payer.routine")}</p>
    </section>
  );

  if (!engineConnectHasAction(engine)) return null;
  return (
    <div data-model-payers className="rounded-xl border border-hairline/40 bg-control/30 p-3">
      <EngineConnect engine={engine} issuer={issuer} onChanged={onChanged} statusLine={false} disconnect={false} />
    </div>
  );
}
