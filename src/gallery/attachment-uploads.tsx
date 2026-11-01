/** Real upload chips with invented data only. ?lang=fr&before=1 renders
 * the pinned base component saved by the screenshot recipe in scratch. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ComposerAttachments } from "../components/ComposerAttachments";
import type { Attachment } from "../lib/composer-attachments";
import { loadLocale } from "../lib/i18n";
import { applySkin } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
await loadLocale(params.get("lang") ?? "en");
applySkin("graphite");
const beforeModule = "/.omb-scratch/work/ComposerAttachments.before.tsx";
const Chips = params.has("before")
  ? (await import(/* @vite-ignore */ beforeModule)).ComposerAttachments
  : ComposerAttachments;

function Gallery() {
  const [items, setItems] = useState<Attachment[]>([
    { kind: "file", id: "clip", name: "synthetic-demo.mp4", path: "", size: 600 * 1024 ** 2, uploading: true, uploadProgress: 58 },
    { kind: "file", id: "retry", name: "synthetic-report.pdf", path: "", size: 120 * 1024 ** 2, uploading: false, uploadError: "Connection interrupted" },
  ]);
  return <main className="min-h-screen bg-panel p-6 text-ink">
    <div className="mx-auto max-w-[760px] rounded-2xl border border-hairline bg-panel p-4">
      <Chips items={items} onAdd={() => {}} onRemove={(id: string) => setItems((current) => current.filter((item) => item.id !== id))}
        onChangeCitation={() => {}} onDisplayInChatBox={() => {}} allowImages notice={null} onNotice={() => {}}
        uploadImage={async () => null} onRetry={(id: string) => setItems((current) => current.map((item) => item.id === id ? { ...item, uploading: true, uploadProgress: 0, uploadError: undefined } as Attachment : item))} />
    </div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Gallery />);
