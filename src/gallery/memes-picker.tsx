/** Synthetic Memes picker + rendered meme bubble for #2121 captures.
 * No live provider key: mocked hits only. */
import { ImagePlay } from "lucide-react";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ATTACH_ICON, ComposerPlusMenu, RecordMark } from "../components/ComposerControls";
import { MemeImage } from "../components/MemeImage";
import { MemePicker } from "../components/MemePicker";
import { loadLocale, t } from "../lib/i18n";
import { applySkin } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
await loadLocale(params.get("lang") ?? "en");
applySkin(params.get("skin") === "pulsatrix-light" || params.get("skin") === "daylight" ? "daylight" : "pulsatrix");

const HITS = [
  {
    id: "tenor:fine",
    title: "This is fine",
    previewUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    width: 120,
    height: 90,
    provider: "tenor" as const,
    attribution: "Via Tenor",
  },
  {
    id: "imgflip:1",
    title: "Distracted Boyfriend",
    previewUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    width: 100,
    height: 100,
    provider: "imgflip" as const,
    attribution: "Imgflip",
    still: true,
  },
  {
    id: "giphy:hi",
    title: "High five",
    previewUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    width: 120,
    height: 90,
    provider: "giphy" as const,
    attribution: "Via GIPHY",
  },
];

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.includes("/api/memes/trending") || url.includes("/api/memes/search")) {
    return new Response(JSON.stringify({ hits: HITS, keyConfigured: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.includes("/api/memes/materialize")) {
    return new Response(JSON.stringify({
      attachment: {
        kind: "image",
        path: "/attachments/synthetic-meme.gif",
        mime: "image/gif",
        name: "this-is-fine.gif",
        meme: { provider: "tenor", attribution: "Via Tenor", sourceId: "tenor:fine" },
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return originalFetch(input, init);
};

function Gallery() {
  const [open, setOpen] = useState(params.get("picker") !== "0");
  const buttonRef = useRef<HTMLSpanElement>(null);
  return (
    <main className="min-h-screen bg-app p-8 text-ink" data-gallery-sample="memes-picker">
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        {/* The + alone in the bar: GIF is a row of its menu, between Attach files and Teach a task */}
        <section className="rounded-2xl border border-border bg-panel p-4 pt-36 shadow-sm" data-gallery-panel="composer-bar">
          <div className="flex min-h-11 items-end gap-1 rounded-[22px] border-[0.5px] border-border bg-composer px-2 py-1.5">
            <div className="composer-band flex flex-wrap items-center gap-2">
              <ComposerPlusMenu initialOpen items={[
                { id: "attach", group: "add", label: t("composer.plus.attach"), icon: ATTACH_ICON, onSelect: () => undefined },
                { id: "gif", group: "add", label: t("composer.plus.gif"), icon: <ImagePlay size={16} aria-hidden="true" />, onSelect: () => undefined },
                { id: "teach", group: "add", label: t("composer.plus.teach"), icon: <RecordMark />, hint: "/learn", onSelect: () => undefined },
              ]} />
            </div>
            <span className="self-center px-1 text-[15px] text-ink-tertiary">Message…</span>
          </div>
        </section>
        <section className="rounded-2xl border border-border bg-panel p-4 shadow-sm" data-gallery-panel="composer">
          <p className="mb-3 text-[13px] text-ink-secondary">Composer</p>
          <div className="relative flex items-center gap-2 rounded-[22px] border border-border bg-composer px-2 py-2">
            <span ref={buttonRef} className="size-7" />
            <span className="text-[13px] text-ink-tertiary">Message…</span>
            <MemePicker
              open={open}
              onClose={() => setOpen(false)}
              anchorRef={buttonRef}
              onPick={() => setOpen(false)}
              onUploadLocal={() => undefined}
            />
          </div>
        </section>
        <section className="rounded-2xl border border-border bg-panel p-4 shadow-sm" data-gallery-panel="bubble">
          <p className="mb-3 text-[13px] text-ink-secondary">In chat</p>
          <MemeImage
            src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
            alt="This is fine"
            attribution="Via Tenor"
            caption="This is fine"
          />
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Gallery />);
