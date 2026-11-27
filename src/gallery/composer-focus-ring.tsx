/** Isolated gallery for the message-bar focus ring (#5444 / M-20261127-059).
 * Real COMPOSER_PILL + MentionTextarea. ?skin=&scheme= is unused; skin= drives
 * applySkin. Cases: idle | click | tab via the capture script. */
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Mic } from "lucide-react";
import { COMPOSER_PILL } from "../components/Composer.tsx-parts/ComposerEditor";
import { MentionTextarea } from "../components/MentionTextarea";
import { trackInputModality } from "../lib/input-modality";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { loadLocale } from "../lib/i18n";
import "../styles.css";

trackInputModality();

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

function Pill() {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // Expose for the capture script.
    (window as unknown as { __composerInput?: HTMLTextAreaElement | null }).__composerInput = inputRef.current;
  });
  return (
    <div className="mx-auto w-[720px] bg-app p-8 text-ink">
      <button type="button" data-focus-start className="mb-4 rounded-md px-2 py-1 text-[13px] text-ink-secondary hover:bg-hover">
        Start
      </button>
      <div data-tour="composer" className={COMPOSER_PILL}>
        <div className="flex items-end gap-1">
          <MentionTextarea
            inputRef={inputRef}
            peers={[]}
            rows={1}
            value=""
            onChange={() => undefined}
            placeholder="Message John Dispatch · Dispatch Services Informatiques"
            aria-label="Message"
            className="block max-h-[7.5rem] min-h-6 w-full resize-none overflow-y-auto bg-transparent chat-input-text px-1 py-1.5 focus:outline-none"
          />
          <span className="flex size-7 items-center justify-center rounded-full bg-ink/[0.06] text-ink-secondary" aria-hidden="true">
            <Mic size={16} />
          </span>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Pill />
  </StrictMode>,
);
