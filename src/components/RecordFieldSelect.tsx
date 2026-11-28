import { useEffect, useRef, useState, type ReactNode } from "react";
import { PillSelect } from "./SettingsPrimitives";
import { t } from "@/lib/i18n";
import { RECORD_CARD_TTL_MS } from "@/lib/record-cards";
import type { RecordChoice } from "@/lib/record-detail";

export type { RecordChoice };

export interface RecordFieldEdit {
  selected?: string;
  /** changes when the choices went stale (a field they depend on was written) */
  stamp?: number;
  load: () => Promise<RecordChoice[]>;
  save: (value: string) => Promise<void>;
}

export function RecordFieldSelect({ edit, label, current, triggerClass, leading }: {
  edit: RecordFieldEdit;
  label: string;
  current: string;
  triggerClass?: string;
  leading?: ReactNode;
}) {
  const [choices, setChoices] = useState<RecordChoice[]>([]);
  const [pending, setPending] = useState<RecordChoice>();
  const [done, setDone] = useState<{ label: string; on: string }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const cachedAt = useRef(0);
  const reading = useRef(0);
  useEffect(() => {
    // stale choices are read again at the next open, and a late answer is dropped
    cachedAt.current = 0;
    reading.current += 1;
    setChoices([]);
    setLoading(false);
  }, [edit.stamp]);
  const load = async () => {
    if (loading || Date.now() - cachedAt.current < RECORD_CARD_TTL_MS) return;
    const mine = ++reading.current;
    setLoading(true);
    setError("");
    try {
      const rows = await edit.load();
      if (mine !== reading.current) return;
      setChoices(rows);
      cachedAt.current = Date.now();
    } catch {
      if (mine === reading.current) setError(t("recordCard.edit.loadFailed"));
    } finally {
      if (mine === reading.current) setLoading(false);
    }
  };
  const save = async (id: string) => {
    const choice = choices.find(option => option.value === id);
    if (!choice || pending) return;
    setPending(choice);
    setError("");
    try {
      await edit.save(id);
      setDone({ label: choice.label, on: current });
    } catch {
      setError(t("recordCard.edit.saveFailed"));
    } finally {
      setPending(undefined);
    }
  };
  // the saved words stand until the card itself says something else
  const shown = done && done.on === current ? done.label : current;
  const selected = pending?.value ?? edit.selected;
  return <div className="inline-flex min-w-0 flex-col items-start">
    <PillSelect leading={leading} value={choices.some(option => option.value === selected) ? selected : undefined}
      options={choices} placeholder={pending?.label ?? shown} ariaLabel={label} disabled={Boolean(pending)}
      searchAbove={8} onOpen={() => void load()} onChange={id => void save(id)} triggerClass={triggerClass}
      emptyLabel={loading ? t("recordCard.loading") : error || undefined} />
    {error && <span role="alert" className="text-[12px] text-danger">{error}</span>}
  </div>;
}
