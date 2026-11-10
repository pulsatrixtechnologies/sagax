// Skills > Upload: SKILL.md files or zipped skill folders from the person's
// computer, several at once (server/routes/bot-skill-upload.ts). The files
// are read here as base64 and sent for a preview first: what each one holds
// (name, description, scan warnings, the files that are not imported) or
// why it is refused. Nothing is added until the person confirms, and then
// the skills arrive switched off, to be read and switched on in the list.
import { cn } from "@/lib/cn";
import { Upload, X } from "lucide-react";
import { useRef, useState, type MutableRefObject } from "react";

import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { ApiError } from "@/state/store";
import { useBotEditor } from "./BotEditorContext";
import { PILL, PRIMARY_PILL, useSettingsSurface } from "../SettingsPrimitives";
import { readableError } from "@/lib/plain-error";

/** Mirrors server/skills/skill-upload.ts. */
export const SKILL_UPLOAD_MAX_FILES = 10;
export const SKILL_MD_MAX_BYTES = 256 * 1024;
export const SKILL_ZIP_MAX_BYTES = 5 * 1024 * 1024;
export const SKILL_UPLOAD_TOTAL_MAX_BYTES = 10 * 1024 * 1024;
export const SKILL_UPLOAD_ACCEPT = ".md,.markdown,.zip,text/markdown,application/zip";

export interface UploadError {
  code: string;
  subject?: string;
  detail: string;
}

export interface UploadPreviewItem {
  file: string;
  kind: "markdown" | "zip";
  errors: UploadError[];
  ignored: string[];
  ignoredCount: number;
  skills: Array<{ name: string; description: string; path: string; bytes: number; warnings: string[]; skippedFiles: string[]; skippedCount: number }>;
}

interface Picked {
  name: string;
  data: string;
}

const ERROR_KEYS: Record<string, LocaleKey> = {
  type: "botPanel.skills.upload.err.type",
  "too-large": "botPanel.skills.upload.err.tooLarge",
  zip: "botPanel.skills.upload.err.zip",
  "unsafe-path": "botPanel.skills.upload.err.unsafePath",
  "no-skill": "botPanel.skills.upload.err.noSkill",
  nested: "botPanel.skills.upload.err.nested",
  "too-many": "botPanel.skills.upload.err.tooMany",
  "not-text": "botPanel.skills.upload.err.notText",
  frontmatter: "botPanel.skills.upload.err.frontmatter",
  exists: "botPanel.skills.upload.err.exists",
  duplicate: "botPanel.skills.upload.err.duplicate",
};

/** One refusal as a sentence in the person's language. */
export function uploadErrorText(item: Pick<UploadPreviewItem, "file">, error: UploadError): string {
  const key = ERROR_KEYS[error.code];
  if (!key) return `${error.subject ?? item.file}: ${error.detail}`;
  return t(key, { subject: error.subject ?? item.file, detail: error.detail });
}

/** A file too large to send, before reading it: null when it fits. */
export function uploadSizeProblem(file: { name: string; size: number }): string | null {
  const zip = /\.zip$/i.test(file.name);
  return file.size > (zip ? SKILL_ZIP_MAX_BYTES : SKILL_MD_MAX_BYTES) ? t("botPanel.skills.upload.tooBig", { file: file.name }) : null;
}

function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(file.name));
    reader.onload = () => {
      const url = String(reader.result ?? "");
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function SkillUploadPreview({ items, onRemove, disabled }: { items: UploadPreviewItem[]; onRemove?: (index: number) => void; disabled?: boolean }) {
  // The bot's profile page (plain surface, #2313): each file a filled tile,
  // no outline; the skill's name in 14px, its lines in 12px grey.
  const plain = useSettingsSurface() === "plain";
  return (
    <ul className="flex flex-col gap-2" data-skill-upload-preview="">
      {items.map((item, index) => (
        <li key={`${item.file}-${index}`} className={plain ? "rounded-lg bg-card px-3 py-2" : "rounded-lg border border-hairline/40 px-3 py-2"} data-skill-upload-item={item.file}>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-secondary">{item.file}</span>
            {onRemove && (
              <button
                type="button"
                disabled={disabled}
                aria-label={t("botPanel.skills.upload.remove", { file: item.file })}
                title={t("botPanel.skills.upload.remove", { file: item.file })}
                onClick={() => onRemove(index)}
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center text-ink-secondary hover:text-ink disabled:opacity-40",
                  plain ? "rounded-full hover:bg-hover" : "rounded-md hover:bg-control",
                )}
              >
                <X size={13} aria-hidden="true" />
              </button>
            )}
          </div>
          {item.skills.map((skill) => (
            <div key={skill.name} className="mt-1.5">
              <div className={plain ? "text-[14px] leading-5 text-ink" : "font-mono text-[12.5px] text-ink"}>{skill.name}</div>
              <div className={cn("line-clamp-2 text-ink-secondary", plain ? "text-[12px] leading-4" : "text-[11.5px]")}>{skill.description}</div>
              {skill.warnings.length > 0 && <div className={cn("mt-0.5 text-warning", plain ? "text-[12px] leading-4" : "text-[10.5px]")}>{skill.warnings.join(" · ")}</div>}
              {skill.skippedCount > 0 && (
                <div className={cn("mt-0.5 break-all text-ink-secondary", plain ? "text-[12px] leading-4" : "text-[10.5px]")}>
                  {t("botPanel.skills.upload.skipped", { files: skill.skippedFiles.join(", ") + (skill.skippedCount > skill.skippedFiles.length ? ", …" : "") })}
                </div>
              )}
            </div>
          ))}
          {item.ignoredCount > 0 && (
            <div className={cn("mt-1 break-all text-ink-secondary", plain ? "text-[12px] leading-4" : "text-[10.5px]")}>
              {t("botPanel.skills.upload.ignored", { files: item.ignored.join(", ") + (item.ignoredCount > item.ignored.length ? ", …" : "") })}
            </div>
          )}
          {item.errors.map((error, at) => (
            <div key={at} role="alert" className={cn("mt-1 text-danger", plain ? "text-[12px] leading-4" : "text-[11.5px]")} data-skill-upload-error={error.code}>
              {uploadErrorText(item, error)}
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}

export function SkillUpload({ botId, disabled, onAdded, pickRef, hideButton = false, className }: {
  botId: string;
  disabled?: boolean;
  onAdded: () => void;
  /** #3400: opens the file picker from elsewhere (the Skills card's "+ Add"). */
  pickRef?: MutableRefObject<(() => void) | null>;
  /** #3400: no Upload pill and no help line here; only what the upload shows once files are picked. */
  hideButton?: boolean;
  className?: string;
}) {
  const { request: api } = useBotEditor();
  const input = useRef<HTMLInputElement>(null);
  if (pickRef) pickRef.current = () => input.current?.click();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [items, setItems] = useState<UploadPreviewItem[] | null>(null);
  const [phase, setPhase] = useState<"idle" | "reading" | "adding">("idle");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const plain = useSettingsSurface() === "plain";

  const preview = async (files: Picked[]) => {
    setPicked(files);
    if (!files.length) {
      setItems(null);
      return;
    }
    setPhase("reading");
    try {
      const result = (await api(`/api/bots/${encodeURIComponent(botId)}/skill-upload`, {
        method: "POST",
        body: JSON.stringify({ mode: "preview", files }),
      })) as { items: UploadPreviewItem[] };
      setItems(result.items);
    } catch (cause) {
      setItems(null);
      setError(t("botPanel.skills.upload.error", { detail: readableError(cause) }));
    } finally {
      setPhase("idle");
    }
  };

  const choose = async (list: FileList | null) => {
    setError("");
    setMessage("");
    const files = [...(list ?? [])];
    if (input.current) input.current.value = "";
    if (!files.length) return;
    if (files.length > SKILL_UPLOAD_MAX_FILES) {
      setError(t("botPanel.skills.upload.tooManyFiles", { count: SKILL_UPLOAD_MAX_FILES }));
      return;
    }
    const tooBig = files.map(uploadSizeProblem).find(Boolean);
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (tooBig || total > SKILL_UPLOAD_TOTAL_MAX_BYTES) {
      setError(tooBig ?? t("botPanel.skills.upload.tooBig", { file: files.map((file) => file.name).join(", ") }));
      return;
    }
    setPhase("reading");
    try {
      await preview(await Promise.all(files.map(async (file) => ({ name: file.name, data: await base64(file) }))));
    } catch (cause) {
      setPhase("idle");
      setError(t("botPanel.skills.upload.error", { detail: readableError(cause) }));
    }
  };

  const add = async () => {
    setPhase("adding");
    setError("");
    try {
      const result = (await api(`/api/bots/${encodeURIComponent(botId)}/skill-upload`, {
        method: "POST",
        body: JSON.stringify({ mode: "install", files: picked }),
      })) as { installed?: string[] };
      setMessage(t("botPanel.skills.upload.added", { count: String((result.installed ?? []).length) }));
      setPicked([]);
      setItems(null);
      onAdded();
    } catch (cause) {
      const body = cause instanceof ApiError ? cause.body : undefined;
      if (Array.isArray(body?.items)) setItems(body.items as UploadPreviewItem[]);
      else setError(t("botPanel.skills.upload.error", { detail: readableError(cause) }));
    } finally {
      setPhase("idle");
    }
  };

  const count = items?.reduce((sum, item) => sum + item.skills.length, 0) ?? 0;
  const refused = items?.some((item) => item.errors.length > 0) ?? false;

  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      data-skill-upload=""
      hidden={hideButton && !items && !message && !error && phase === "idle"}
    >
      <div className="flex items-center gap-2">
        <input
          ref={input}
          type="file"
          multiple
          accept={SKILL_UPLOAD_ACCEPT}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => void choose(event.target.files)}
        />
        {!hideButton && <button
          type="button"
          data-skill-upload-button=""
          aria-label={t("botPanel.skills.upload.aria")}
          disabled={disabled || phase !== "idle"}
          onClick={() => input.current?.click()}
          className={cn(PILL, "shrink-0 gap-1.5")}
        >
          <Upload size={14} aria-hidden="true" />
          {phase === "reading" ? t("botPanel.skills.upload.reading") : t("botPanel.skills.upload.button")}
        </button>}
        {!hideButton && <span className={cn("leading-snug text-ink-secondary", plain ? "text-[12px]" : "text-[11.5px]")}>{t("botPanel.skills.upload.help")}</span>}
        {hideButton && phase === "reading" && <span role="status" className="text-[12px] leading-4 text-ink-secondary">{t("botPanel.skills.upload.reading")}</span>}
      </div>
      {items && (
        <div className="flex flex-col gap-2 rounded-xl bg-inset p-3">
          <div className={plain ? "text-[14px] leading-5 text-ink" : "text-[13px] font-medium text-ink"}>{t("botPanel.skills.upload.previewTitle")}</div>
          <div className={cn("text-ink-secondary", plain ? "text-[12px] leading-4" : "text-[11.5px]")}>{t("botPanel.skills.upload.previewIntro")}</div>
          <SkillUploadPreview
            items={items}
            disabled={phase !== "idle"}
            onRemove={(index) => void preview(picked.filter((_entry, at) => at !== index))}
          />
          {refused && <div className={cn("text-danger", plain ? "text-[12px] leading-4" : "text-[11.5px]")}>{t("botPanel.skills.upload.fixFirst")}</div>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={phase !== "idle"}
              onClick={() => {
                setPicked([]);
                setItems(null);
              }}
              className={plain ? PILL : "rounded-lg px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-raised disabled:opacity-40"}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              data-skill-upload-add=""
              disabled={phase !== "idle" || refused || count === 0}
              onClick={() => void add()}
              className={plain ? PILL : PRIMARY_PILL}
            >
              {phase === "adding" ? t("botPanel.skills.upload.adding") : t("botPanel.skills.upload.add", { count: String(count) })}
            </button>
          </div>
        </div>
      )}
      {message && <div className="text-[12px] text-ink-secondary">{message}</div>}
      {error && <div role="alert" className="text-[12px] text-danger">{error}</div>}
    </div>
  );
}
