// The invoice window (M-20261127-101, M-20261127-140): the invoice's whole
// detail, drawn as a document. At the left, the document: its number and
// dates, who it is billed to, the tickets and the agreement it comes from,
// its lines with their detail, the subtotal, each tax (GST, QST), the total
// and what is paid. At the right: the balance due and how late it is, Send a
// reminder, Record a payment and PDF, the timeline (issued, sent, due,
// reminder, next reminder) and the company's summary. Tabs across the
// window: Invoice, Payments, History.
//
// Every word and every amount is the console's: the `document`, `payments`
// and `history` sections of the detail route, else the invoice's card. A
// console that serves no detail for invoices leaves the card's own facts in
// the same layout (its lines, its amounts under their own labels), and what
// it does not send is not shown: nothing is computed or made up here
// (agent's choice). How late it is follows the card's one rule
// (recordLateness). Send a reminder goes through a bot in the chat, which
// writes and sends it as the person (agent's choice, like Schedule me,
// D-20261127-007); Record a payment is one checked action of the window
// (`payment.add`, shared/record-actions.ts); PDF is the detail route's own
// download.
import { useEffect, useState, type ReactNode } from "react";
import { Download, FileText, Plus, Send } from "lucide-react";
import { FieldValue, recordLateness, TONE_DOT, type RecordWindowLayout } from "@/components/RecordCard";
import { RecordMarkdown } from "@/components/RecordMarkdown";
import { RECORD_ACTION, RECORD_PRIMARY, RecordAddButton, RecordEntryForm, RecordPod, RecordWindowTabs, type RecordTab } from "@/components/record-window/RecordBlocks";
import { RecordSplit } from "@/components/record-window/RecordSplit";
import { RecordName, dayOf } from "@/components/record-window/ticket/parts";
import type { RecordDetail } from "@/components/useRecordDetail";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { formatAbsolute, formatFull } from "@/lib/record-card-format";
import { downloadAttachment, type HistoryRow, type InvoiceDocument, type InvoiceLine, type InvoiceStep, type PaymentRow } from "@/lib/record-detail";
import type { RecordCard as Card, RecordField, RecordRef, RecordTone } from "../../../../shared/record-cards";

export const INVOICE_TABS = ["invoice", "payments", "history"] as const;
export type InvoiceTab = (typeof INVOICE_TABS)[number];
export interface InvoiceView { tab: InvoiceTab }
export const INVOICE_VIEW: InvoiceView = { tab: "invoice" };

export interface InvoiceWindowProps {
  card: Card;
  record: RecordRef;
  /** the detail route's sections; absent: the console serves none for invoices, the card's facts are shown */
  detail?: RecordDetail;
  /** the window's type (its split is kept for it) */
  type: string;
  now: number;
  view?: InvoiceView;
  onView: (view: InvoiceView) => void;
  /** a bot writes and sends the reminder in the chat */
  onRemind?: () => void;
}

/** A calendar day or an instant as a date with its year, in the record's zone. */
function dateText(at: string, now: number, tz?: string): ReactNode {
  const lang = activeLocale();
  return <time dateTime={at} title={formatFull(at, lang, tz)}>{formatAbsolute(at, now, lang, tz, { time: false, year: true })}</time>;
}

/** How late the invoice is: the card's own rule (recordLateness) on the document's due day, never once the product says nothing is owed. */
export function invoiceLateness(card: Card, doc: InvoiceDocument | undefined, now: number): string | null {
  return doc?.owed === false ? null : recordLateness(card, now, activeLocale(), card.tz, doc?.due ?? card.dates?.due);
}

/** The invoice's tabs across the window, its body, and its lateness as a pill of the head (the mockup's). */
export function invoiceWindow(props: InvoiceWindowProps): RecordWindowLayout {
  const view = props.view ?? INVOICE_VIEW;
  const { detail } = props;
  const idPrefix = `invoice-${props.card.id}`;
  const payments = detail?.section("payments").page;
  const history = detail?.section("history").page;
  const tabs: RecordTab<InvoiceTab>[] = [
    { id: "invoice", label: t("recordWindow.invoice.tabs.invoice"), canAdd: true },
    // a console that serves no detail for invoices has no payments nor history to show (known once the counts answered)
    ...(detail?.ready ? [
      { id: "payments" as const, label: t("recordWindow.invoice.tabs.payments"), count: payments?.lines.length ?? detail.counts.payments, canAdd: detail.can("payment.add") },
      { id: "history" as const, label: t("recordWindow.invoice.tabs.history"), count: history?.lines.length ?? detail.counts.history },
    ] : []),
  ];
  const tab = tabs.some((one) => one.id === view.tab) ? view.tab : "invoice";
  const late = invoiceLateness(props.card, detail?.section("document").page?.document, props.now);
  return {
    ...(late ? { chips: [{ label: t("recordWindow.invoice.lateBy", { duration: late }), tone: "alert" as const }] } : {}),
    tabs: <RecordWindowTabs tabs={tabs} tab={tab} onTab={(next) => props.onView({ tab: next })} label={t("recordWindow.invoice.tabs.label")} idPrefix={idPrefix} />,
    body: <InvoiceBody {...props} tab={tab} idPrefix={idPrefix} />,
  };
}

/** What the card holds, read for an invoice: who it is billed to (the company it names), the records it comes from, its other facts, its amounts. */
export function invoiceFacts(card: Card) {
  const fields = card.fields ?? [];
  const billed = fields.find((field) => field.type === "ref" && field.ref?.kind === "company");
  return {
    billedTo: billed ? { name: billed.value, ...(billed.ref ? { ref: billed.ref } : {}) } : card.company ? { name: card.company.name, ...(card.company.ref ? { ref: card.company.ref } : {}) } : undefined,
    links: fields.filter((field) => field !== billed && (field.type === "ref" || (field.type === "person" && field.ref))),
    amounts: fields.filter((field) => field.type === "money"),
    facts: fields.filter((field) => field !== billed && field.type !== "ref" && field.type !== "money" && !(field.type === "person" && field.ref)),
  };
}

function Label({ children }: { children: ReactNode }) {
  return <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{children}</span>;
}

/** The document: its head, who it is billed to and what it comes from, its lines, its totals. */
function InvoiceDocumentPod({ card, doc, lines, now }: { card: Card; doc?: InvoiceDocument; lines?: InvoiceLine[]; now: number }) {
  const lang = activeLocale();
  const tz = card.tz;
  const facts = invoiceFacts(card);
  const billedTo: { name: string; ref?: RecordRef; attention?: string; address?: string[] } | undefined = doc?.billedTo ?? facts.billedTo;
  const due = doc?.due ?? card.dates?.due;
  // the document's own lines, else the card's list (its first lines, the rest named)
  const cardLines = card.lines;
  const shown: InvoiceLine[] = lines ?? (cardLines?.items ?? []).map((line) => ({ label: line.label, ...(line.detail ? { detail: line.detail } : {}), amount: line.value ?? "", ...(line.ref ? { ref: line.ref } : {}) }));
  const others = lines ? 0 : Math.max(0, (cardLines?.total ?? shown.length) - shown.length);
  const totals: Array<{ key: string; label: string; value: ReactNode; grand?: boolean }> = doc ? [
    ...(doc.subtotal ? [{ key: "subtotal", label: t("recordWindow.invoice.subtotal"), value: doc.subtotal }] : []),
    ...doc.taxes.map((tax, index) => ({ key: `tax-${index}`, label: tax.label, value: tax.amount })),
    ...(doc.total ? [{ key: "total", label: t("recordWindow.invoice.total"), value: doc.total, grand: true }] : []),
    ...(doc.paid ? [{ key: "paid", label: t("recordWindow.invoice.paid"), value: doc.paid }] : []),
  ] : facts.amounts.map((field, index) => ({ key: `amount-${index}`, label: field.label, value: <FieldValue field={field} label={field.label} now={now} lang={lang} tz={tz} /> }));
  const links = doc ? doc.links : facts.links.map((field: RecordField) => ({ label: field.value, ...(field.ref ? { ref: field.ref } : {}), ...(field.detail ? { detail: field.detail } : {}) }));
  return (
    <RecordPod className="gap-5" data-invoice-document="">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <Label>{card.kind.name}</Label>
          <span className="text-[20px] font-semibold leading-7 tabular-nums" data-invoice-number="">{card.number}</span>
        </div>
        <div className="flex flex-col items-end text-end text-[13px] leading-[18px] text-popover-ink-secondary">
          {doc?.issued && <span data-invoice-issued="">{t("recordWindow.invoice.issued")} {dateText(doc.issued, now, tz)}</span>}
          {due && <span data-invoice-due="">{t("recordWindow.invoice.due")} {dateText(due, now, tz)}{doc?.terms ? ` · ${doc.terms}` : ""}</span>}
        </div>
      </div>
      {(billedTo || links.length > 0) && (
        <div className="grid min-w-0 grid-cols-1 gap-x-10 gap-y-4 @min-[44rem]:grid-cols-2">
          {billedTo && (
            <div className="flex min-w-0 flex-col gap-0.5" data-invoice-billed-to="">
              <Label>{t("recordWindow.invoice.billedTo")}</Label>
              <span><RecordName name={billedTo.name} recordRef={billedTo.ref} /></span>
              {billedTo.attention && <Label>{t("recordWindow.invoice.attention", { name: billedTo.attention })}</Label>}
              {billedTo.address?.map((line, index) => <Label key={index}>{line}</Label>)}
            </div>
          )}
          {links.length > 0 && (
            <div className="flex min-w-0 flex-col gap-0.5" data-invoice-links="">
              <Label>{t("recordWindow.invoice.linkedTo")}</Label>
              {/* the tickets on one line, a chip never cut inside; the agreement and the project each on its own line under them (the mockup's) */}
              {links.some((link) => link.ref?.kind === "ticket") && (
                <p className="min-w-0 leading-7">
                  {links.filter((link) => link.ref?.kind === "ticket").map((link, index) => (
                    <span key={`${link.label}-${index}`} className="whitespace-nowrap">
                      {index > 0 && <span aria-hidden="true" className="px-1.5 text-popover-ink">·</span>}
                      <RecordName name={link.label} recordRef={link.ref} />
                    </span>
                  ))}
                </p>
              )}
              {links.filter((link) => link.ref?.kind !== "ticket").map((link, index) => (
                <span key={`${link.label}-${index}`} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 leading-7">
                  <RecordName name={link.label} recordRef={link.ref} />
                  {link.detail && <Label>{link.detail}</Label>}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {!doc && facts.facts.length > 0 && (
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5" data-invoice-facts="">
          {facts.facts.map((field, index) => (
            <div key={`${field.label}-${index}`} className="contents">
              <dt><Label>{field.label}</Label></dt>
              <dd className="min-w-0"><FieldValue field={field} label={field.label} now={now} lang={lang} tz={tz} /></dd>
            </div>
          ))}
        </dl>
      )}
      {cardLines && !lines && cardLines.state !== "ok" && cardLines.state !== "none" ? (
        <p role="status" className="text-popover-ink-secondary">{t(cardLines.state === "forbidden" ? "recordCard.lines.forbidden" : "recordCard.lines.unavailable")}</p>
      ) : shown.length > 0 && (
        <div className="flex min-w-0 flex-col" data-invoice-lines="">
          {!lines && cardLines?.title && <Label>{cardLines.title}</Label>}
          <ul className="flex min-w-0 flex-col divide-y divide-popover-hairline border-b border-popover-hairline">
            {shown.map((line, index) => (
              <li key={line.id ?? index} className="flex min-w-0 items-start gap-4 py-3" data-invoice-line="">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="break-words">{line.ref ? <RecordName name={line.label} recordRef={line.ref} /> : line.label}</span>
                  {line.detail && <Label>{line.detail}</Label>}
                </span>
                {line.amount && <span className="shrink-0 font-medium tabular-nums" data-record-money="">{line.amount}</span>}
              </li>
            ))}
          </ul>
          {others > 0 && <span className="pt-2"><Label>{t(others === 1 ? "recordCard.more.lineOne" : "recordCard.more.lineMany", { count: others })}</Label></span>}
        </div>
      )}
      {totals.length > 0 && (
        <dl className="ms-auto grid min-w-0 grid-cols-[auto_auto] items-baseline gap-x-8 gap-y-2" data-invoice-totals="">
          {totals.map((row) => (
            <div key={row.key} className="contents" data-invoice-total={row.key}>
              <dt className={cn(row.grand ? "text-[16px] font-semibold" : "text-[13px] text-popover-ink-secondary")}>{row.label}</dt>
              <dd className={cn("text-end tabular-nums", row.grand ? "text-[17px] font-semibold" : "font-medium")}>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {card.description?.text && <div className="border-t border-popover-hairline pt-4 text-[14px] leading-[21px] text-popover-ink-secondary" data-record-description=""><RecordMarkdown text={card.description.text} /></div>}
    </RecordPod>
  );
}

/** A timeline (the invoice's steps, its history): a dot of its tone on a rail, the words, the date under them. A step still to come is a ring. */
function Timeline({ items, ...data }: { items: Array<{ key: string; tone: RecordTone | "next"; title: ReactNode; date?: ReactNode; attributes?: Record<`data-${string}`, string> }> } & Record<`data-${string}`, string>) {
  return (
    <ol className="flex flex-col" {...data}>
      {items.map((item, index) => (
        <li key={item.key} className="relative flex gap-3 pb-3 last:pb-0" data-tone={item.tone} {...item.attributes}>
          {index < items.length - 1 && <span aria-hidden="true" className="absolute start-[5px] top-4 h-[calc(100%-12px)] w-px bg-popover-hairline" />}
          <span aria-hidden="true" className={cn("mt-1 size-3 shrink-0 rounded-full", item.tone === "next" ? "border-2 border-popover-ink-secondary" : TONE_DOT[item.tone])} />
          <span className="flex min-w-0 flex-col">
            <span className="break-words">{item.title}</span>
            {item.date && <Label>{item.date}</Label>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The timeline: issued, sent, due, reminder, next reminder; the due step late once it is passed and still owed. */
function StepsPod({ doc, late, now, tz }: { doc: InvoiceDocument; late: boolean; now: number; tz?: string }) {
  if (!doc.steps.length) return null;
  const words = (step: InvoiceStep, who?: string) => step === "sent" && who ? t("recordWindow.invoice.step.sentTo", { name: who })
    : step === "due" ? t(late ? "recordWindow.invoice.step.overdue" : "recordWindow.invoice.step.due")
    : t(`recordWindow.invoice.step.${step === "next_reminder" ? "nextReminder" : step}` as "recordWindow.invoice.step.issued");
  return (
    <RecordPod title={t("recordWindow.invoice.steps")} data-invoice-steps="">
      <Timeline items={doc.steps.map((step, index) => ({
        key: `${step.step}-${index}`,
        tone: step.step === "due" ? (late ? "alert" : step.done ? "done" : "next") : step.done === false || step.step === "next_reminder" ? "next" : "done",
        title: words(step.step, step.who),
        ...(step.at ? { date: dateText(step.at, now, tz) } : {}),
        attributes: { "data-invoice-step": step.step },
      }))} />
    </RecordPod>
  );
}

/** Record a payment: amount and day only. ConnectWise has no reference or note on a payment; the console drops them, so the form does not offer them (M-20261127-101). */
function PaymentForm({ detail, now, tz, onDone }: { detail: RecordDetail; now: number; tz?: string; onDone: () => void }) {
  // today in the record's zone, as the console reads a day
  const today = dayOf(new Date(now).toISOString(), "", tz).key;
  return (
    <RecordEntryForm data-invoice-payment-form=""
      fields={[
        { key: "amount", label: t("recordWindow.invoice.payment.amount"), kind: "number", required: true, min: 0.01, step: 0.01 },
        { key: "date", label: t("recordWindow.invoice.payment.date"), kind: "date", required: true, value: today },
      ]}
      submitLabel={t("recordWindow.invoice.payment.save")}
      onCancel={onDone}
      onSubmit={async (values) => {
        const text = (key: string) => (typeof values[key] === "string" ? (values[key] as string).trim() : "");
        await detail.write({ action: "payment.add", set: { amount: text("amount"), date: text("date") } });
        onDone();
      }} />
  );
}

function InvoiceBody({ card, record, detail, type, now, tab, idPrefix, onRemind }: InvoiceWindowProps & { tab: InvoiceTab; idPrefix: string }) {
  const want = detail?.want;
  const ready = Boolean(detail?.ready);
  // the document at once; the payments and the history once the console said it serves invoices
  useEffect(() => { want?.(["document"]); }, [want]);
  useEffect(() => { if (ready) want?.(["payments", "history"]); }, [want, ready]);
  const [paying, setPaying] = useState(false);
  const [asked, setAsked] = useState(false);
  const [pdfFailed, setPdfFailed] = useState(false);
  const tz = card.tz;
  const documentPage = detail?.section("document").page;
  const doc = documentPage?.document;
  const due = doc?.due ?? card.dates?.due;
  const lateBy = invoiceLateness(card, doc, now);
  // offered once the counts answered: a console that serves no detail for invoices never shows it, not even for a moment
  const canPay = ready && Boolean(detail?.can("payment.add"));
  const form = paying && detail ? <PaymentForm detail={detail} now={now} tz={tz} onDone={() => setPaying(false)} /> : null;
  const payButton = (primary = false) => canPay && (
    <button type="button" className={primary ? RECORD_PRIMARY : RECORD_ACTION} onClick={() => setPaying(true)} data-invoice-pay=""><Plus size={14} aria-hidden="true" />{t("recordWindow.invoice.recordPayment")}</button>
  );
  const panel = (children: ReactNode) => (
    <div className="record-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain" role="tabpanel" id={`${idPrefix}-panel-${tab}`} aria-labelledby={`${idPrefix}-tab-${tab}`} data-invoice-tab={tab}>
      <div className="flex min-w-0 flex-col gap-3 p-4">{children}</div>
    </div>
  );

  if (tab === "payments" && detail) {
    const payments = detail.section("payments");
    const rows: PaymentRow[] = payments.page?.lines ?? [];
    return panel(<>
      {form}
      {payments.error ? <p role="status" className="py-2 text-popover-ink-secondary">{payments.error}</p>
        : payments.loading && !payments.page ? <p role="status" className="py-2 text-popover-ink-secondary">{t("recordCard.loading")}</p>
        : rows.length ? (
          <RecordPod title={t("recordWindow.invoice.tabs.payments")} count={rows.length} actions={canPay && <RecordAddButton label={t("recordWindow.invoice.recordPayment")} onAdd={() => setPaying(true)} />} data-invoice-payments="">
            <ul className="flex min-w-0 flex-col divide-y divide-popover-hairline">
              {rows.map((row, index) => (
                <li key={row.id ?? index} className="flex min-w-0 items-center gap-3 py-2.5" data-invoice-payment="">
                  <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-popover-hover text-popover-ink-secondary"><FileText size={14} /></span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="break-words">{[row.type, row.reference].filter(Boolean).join(" · ") || t("recordWindow.invoice.payment.one")}</span>
                    <Label>{[row.day ? formatAbsolute(row.day, now, activeLocale(), tz, { time: false, year: true }) : row.date, row.by].filter(Boolean).join(" · ")}</Label>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums" data-record-money="">{row.amount}</span>
                </li>
              ))}
            </ul>
          </RecordPod>
        ) : (
          <RecordPod className="py-8" bodyClassName="items-center gap-1.5 text-center" data-invoice-payments="">
            <span aria-hidden="true" className="mx-auto inline-flex size-11 items-center justify-center rounded-xl bg-popover-hover text-popover-ink-secondary"><FileText size={18} /></span>
            <span className="font-semibold">{t("recordWindow.invoice.noPayment")}</span>
            {doc?.balance && due && doc.owed !== false && <Label>{t("recordWindow.invoice.stillOwed", { amount: doc.balance, date: formatAbsolute(due, now, activeLocale(), tz, { time: false, year: true }) })}</Label>}
            {!form && <span className="mt-2 flex justify-center">{payButton(true)}</span>}
          </RecordPod>
        )}
    </>);
  }

  if (tab === "history" && detail) {
    const history = detail.section("history");
    const rows: HistoryRow[] = history.page?.lines ?? [];
    return panel(
      history.error ? <p role="status" className="py-2 text-popover-ink-secondary">{history.error}</p>
        : history.loading && !history.page ? <p role="status" className="py-2 text-popover-ink-secondary">{t("recordCard.loading")}</p>
        : (
          <RecordPod data-invoice-history="">
            {!rows.length && <p className="text-popover-ink-secondary">{t("recordWindow.invoice.noHistory")}</p>}
            <Timeline items={rows.map((row, index) => ({
              key: row.id ?? String(index), tone: row.tone ?? "done", title: row.text,
              date: row.at ? <time dateTime={row.at} title={formatFull(row.at, activeLocale(), tz)}>{formatAbsolute(row.at, now, activeLocale(), tz, { year: true })}</time> : row.date,
              attributes: { "data-invoice-event": "" },
            }))} />
          </RecordPod>
        ),
    );
  }

  const documentState = detail?.section("document");
  const side = (
    <div className="flex min-w-0 flex-col gap-3 p-4" data-invoice-side="">
      <RecordPod data-invoice-balance="">
        {doc?.balance && <><Label>{t("recordWindow.invoice.balanceDue")}</Label><span className={cn("text-[28px] font-semibold leading-9 tabular-nums", lateBy && "text-danger")} data-record-money="">{doc.balance}</span></>}
        {lateBy && <Label>{t("recordWindow.invoice.lateBy", { duration: lateBy })}</Label>}
        {(onRemind || canPay || doc?.pdf) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {onRemind && doc?.owed !== false && card.state?.tone !== "done" && (
              <button type="button" className={RECORD_PRIMARY} title={t("recordWindow.invoice.remindHint")} onClick={() => { onRemind(); setAsked(true); }} data-invoice-remind=""><Send size={14} aria-hidden="true" />{t("recordWindow.invoice.remind")}</button>
            )}
            {payButton()}
            {doc?.pdf && (
              <button type="button" className={RECORD_ACTION} onClick={() => { setPdfFailed(false); void downloadAttachment(record, "pdf", `${card.number}.pdf`).catch(() => setPdfFailed(true)); }} data-invoice-pdf="">
                <Download size={14} aria-hidden="true" />PDF
              </button>
            )}
          </div>
        )}
        {asked && <p role="status" className="text-[13px] leading-[18px] text-popover-ink-secondary" data-record-bot-asked="">{t("recordWindow.invoice.remindAsked")}</p>}
        {pdfFailed && <p role="alert" className="text-[13px] leading-[18px] text-danger">{t("recordWindow.invoice.pdfFailed")}</p>}
      </RecordPod>
      {form}
      {doc && <StepsPod doc={doc} late={Boolean(lateBy)} now={now} tz={tz} />}
      {doc?.client && (
        <RecordPod title={t("recordWindow.invoice.client")} data-invoice-client="">
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2">
            {doc.client.balance && <><dt><Label>{t("recordWindow.invoice.clientBalance")}</Label></dt><dd className="tabular-nums">{doc.client.balance}</dd></>}
            {doc.client.late && <><dt><Label>{t("recordWindow.invoice.clientLate")}</Label></dt><dd className="tabular-nums text-danger">{doc.client.late}</dd></>}
            {doc.client.paysIn && <><dt><Label>{t("recordWindow.invoice.clientPaysIn")}</Label></dt><dd>{doc.client.paysIn}</dd></>}
          </dl>
        </RecordPod>
      )}
    </div>
  );
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-invoice`} aria-labelledby={`${idPrefix}-tab-invoice`} className="flex min-h-0 flex-1 flex-col" data-invoice-tab="invoice">
      <RecordSplit type={type} fallback={720} least={420} rightLeast={300} stackBelow={820}
        left={<div className="flex min-w-0 flex-col gap-3 p-4">
          {documentState?.error && <p role="status" className="text-[13px] text-popover-ink-secondary">{documentState.error}</p>}
          <InvoiceDocumentPod card={card} doc={doc} lines={documentPage && doc ? documentPage.lines : undefined} now={now} />
        </div>}
        right={side} />
    </div>
  );
}
