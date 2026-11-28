// A ticket's Configurations and Attachments tabs (M-20261127-107): one list
// under the one filter, "+ Configuration" and "+ Attachment" at the right
// opening their form, an entry removed at its right; a configuration opens
// its record in the window when the person may.
import { useEffect, useState } from "react";
import { Download, FileText, Monitor, Plus } from "lucide-react";
import { RECORD_ACTION, RecordEntryForm, RecordRowActions, RecordSectionStatus as Status } from "@/components/record-window/RecordBlocks";
import { RecordList, type RecordColumn } from "@/components/record-window/RecordGrid";
import type { RecordDetail } from "@/components/useRecordDetail";
import { t } from "@/lib/i18n";
import { attachmentOf, type AttachmentRow, type ConfigurationRow, type RecordChoice } from "@/lib/record-detail";
import { RecordName } from "./parts";

export function TicketConfigurationsTab({ detail }: { detail: RecordDetail }) {
  const state = detail.section("configurations");
  const [adding, setAdding] = useState(false);
  const [choices, setChoices] = useState<RecordChoice[] | undefined>();
  const { choices: read } = detail;
  useEffect(() => {
    if (!adding) return;
    let current = true;
    read("configuration").then((list) => { if (current) setChoices(list); }, () => { if (current) setChoices([]); });
    return () => { current = false; };
  }, [adding, read]);
  const columns: RecordColumn<ConfigurationRow>[] = [
    { id: "name", label: t("recordCard.related.name"), text: (row) => row.name },
    { id: "type", label: t("recordCard.related.type"), text: (row) => row.type },
    { id: "status", label: t("recordCard.related.status"), text: (row) => row.status },
  ];
  const canAdd = detail.can("configuration.add");
  return (
    <div className="flex min-w-0 flex-col gap-3 p-4" data-record-tab-panel="configurations">
      {adding && (
        <RecordEntryForm data-record-configuration-form=""
          fields={[{ key: "configuration", label: t("recordWindow.configurations.pick"), kind: "choice", required: true, choices: choices ?? [] }]}
          submitLabel={t("recordWindow.configurations.add")} onCancel={() => setAdding(false)}
          onSubmit={async (values) => { await detail.write({ action: "configuration.add", set: { configuration: String(values.configuration ?? "") } }); setAdding(false); }} />
      )}
      {!state.page ? <Status state={state} /> : (
        <RecordList label={t("recordWindow.tabs.configurations")} columns={columns} rows={state.page.lines} rowKey={(row) => row.id ?? `${row.name}-${row.type}`}
          toolbar={canAdd && !adding ? <button type="button" className={RECORD_ACTION} onClick={() => setAdding(true)} data-record-add-configuration=""><Plus size={14} aria-hidden="true" />{t("recordWindow.configurations.add")}</button> : undefined}
          row={(row) => (
            <>
              <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-popover-field text-popover-ink-secondary"><Monitor size={16} /></span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="min-w-0 font-medium"><RecordName name={row.name} recordRef={row.ref} /></span>
                <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{[row.type, row.status].filter(Boolean).join(" · ")}</span>
              </span>
              <RecordRowActions name={row.name} onRemove={row.id && detail.can("configuration.remove") ? () => detail.write({ action: "configuration.remove", id: row.id! }) : undefined} />
            </>
          )} />
      )}
    </div>
  );
}

export function TicketAttachmentsTab({ detail }: { detail: RecordDetail }) {
  const state = detail.section("attachments");
  const [adding, setAdding] = useState(false);
  const columns: RecordColumn<AttachmentRow>[] = [
    { id: "name", label: t("recordCard.related.name"), text: (row) => row.name },
    { id: "date", label: t("recordCard.related.date"), kind: "date", text: (row) => row.date },
  ];
  const canAdd = detail.can("attachment.add");
  return (
    <div className="flex min-w-0 flex-col gap-3 p-4" data-record-tab-panel="attachments">
      {detail.notice && <p role="status" className="text-[13px] leading-[18px] text-danger">{detail.notice}</p>}
      {adding && (
        <RecordEntryForm data-record-attachment-form=""
          fields={[{ key: "file", label: t("recordWindow.attachments.file"), kind: "file", required: true }]}
          submitLabel={t("recordWindow.attachments.add")} onCancel={() => setAdding(false)}
          onSubmit={async (values) => {
            const file = values.file;
            if (!(file instanceof File)) return;
            await detail.write({ action: "attachment.add", set: await attachmentOf(file) });
            setAdding(false);
          }} />
      )}
      {!state.page ? <Status state={state} /> : (
        <RecordList label={t("recordWindow.tabs.attachments")} columns={columns} rows={state.page.lines} rowKey={(row) => row.id || row.name}
          toolbar={canAdd && !adding ? <button type="button" className={RECORD_ACTION} onClick={() => setAdding(true)} data-record-add-attachment=""><Plus size={14} aria-hidden="true" />{t("recordWindow.attachments.add")}</button> : undefined}
          row={(row) => (
            <>
              <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-popover-field text-popover-ink-secondary"><FileText size={16} /></span>
              <span className="flex min-w-0 flex-1 flex-col">
                <button type="button" className="min-w-0 break-all text-start font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onClick={row.download} data-record-attachment="">{row.name}</button>
                <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{[row.size, row.date].filter(Boolean).join(" · ")}</span>
              </span>
              <button type="button" className={RECORD_ACTION} onClick={row.download} aria-label={t("recordWindow.attachments.open", { name: row.name })}><Download size={14} aria-hidden="true" />{t("recordWindow.attachments.openShort")}</button>
              <RecordRowActions name={row.name} onRemove={row.id && detail.can("attachment.remove") ? () => detail.write({ action: "attachment.remove", id: row.id }) : undefined} />
            </>
          )} />
      )}
    </div>
  );
}
