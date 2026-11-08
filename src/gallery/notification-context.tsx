/** Isolated gallery for headless screenshots of a decision's notification
 * (#2909): the desktop native banner (macOS, Windows) and the phone's Updates
 * row, each from the real rules: the context (src/lib/notify.ts
 * `decisionBannerBody`, shared/notification-context.ts), whole short labels
 * or Open only. The native banners and the SwiftUI row are drawn here in
 * HTML with the same words; the OS draws the real ones.
 * Neutral fictional bots and tickets. Not shipped in the app.
 * ?skin=<id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { decisionBannerBody } from "../lib/notify";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { buildNotificationContext, notificationChoiceLabels } from "../../shared/notification-context";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
const skin = skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin();
applySkin(skin);
const dark = !skin.endsWith("-light");

interface Sample {
  id: string;
  bot: string;
  color: string;
  subtitle: string;
  question: string;
  detail: string;
  choices: { answer: string; detail?: string }[];
}

// the capture behind #2909: a routine stopped on a decision whose answers are sentences
const capture: Sample = {
  id: "capture",
  bot: "Atlas",
  color: "#3b82f6",
  subtitle: "Routine Temps",
  question: "Je fais quoi avec ces entrées ?",
  detail: "Le billet #41872 a 3 entrées de temps sans note.\n\n| Membre | Heures |\n|---|---|\n| Alex | 2,5 |\n| Sam | 1,0 |",
  choices: [
    { answer: "Ajouter une note générique à chaque entrée et les soumettre" },
    { answer: "Laisser les entrées telles quelles et te les envoyer pour révision" },
    { answer: "Supprimer les entrées et les recréer à partir de l'agenda" },
  ],
};
// short answers: whole buttons, each saying what it does
const legible: Sample = {
  id: "legible",
  bot: "Nova",
  color: "#ec4899",
  subtitle: "Rapport mensuel",
  question: "Je garde la copie locale ou celle du serveur ?",
  detail: "Deux copies du rapport diffèrent.\n\n| Copie | Date | Taille |\n|---|---|---:|\n| Locale | 7 nov. | 12 Ko |\n| Serveur | 8 nov. | 14 Ko |",
  choices: [{ answer: "Locale", detail: "Garde tes changements d'hier" }, { answer: "Serveur", detail: "Reprend la version publiée" }],
};

function words(sample: Sample) {
  const context = buildNotificationContext({ question: sample.question, detail: sample.detail, choices: sample.choices });
  const body = decisionBannerBody({ kind: "needs-you", context }) ?? context;
  const labels = notificationChoiceLabels(sample.choices.map((choice) => choice.answer)).labels;
  return { body, labels: labels ?? ["Ouvrir"], open: !labels };
}

const ink = dark ? "#e8edf5" : "#111827";
const muted = dark ? "#9aa4b2" : "#4b5563";
const glass = dark ? "rgba(40,44,52,0.92)" : "rgba(246,246,248,0.95)";
const line = dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)";

function Avatar({ sample, size }: { sample: Sample; size: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size / 2, background: sample.color, color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: size * 0.45, flex: "none" }}>
      {sample.bot[0]}
    </div>
  );
}

function MacBanner({ sample }: { sample: Sample }) {
  const { body, labels } = words(sample);
  return (
    <div data-banner="mac" style={{ width: 380, borderRadius: 16, background: glass, border: `1px solid ${line}`, boxShadow: "0 8px 30px rgba(0,0,0,.25)", color: ink, font: "13px/1.4 -apple-system, system-ui", overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 10, padding: 12 }}>
        <Avatar sample={sample} size={36} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{sample.bot}</div>
          <div style={{ fontWeight: 600, color: muted }}>{sample.subtitle}</div>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{body}</div>
        </div>
      </div>
      <div style={{ display: "flex", borderTop: `1px solid ${line}` }}>
        {labels.map((label) => (
          <div key={label} style={{ flex: 1, textAlign: "center", padding: "8px 4px", fontWeight: 600, borderLeft: `1px solid ${line}`, whiteSpace: "nowrap" }}>{label}</div>
        ))}
      </div>
    </div>
  );
}

function WindowsToast({ sample }: { sample: Sample }) {
  const { body, labels } = words(sample);
  return (
    <div data-banner="windows" style={{ width: 380, background: dark ? "#2b2b2b" : "#f3f3f3", border: `1px solid ${line}`, borderRadius: 8, color: ink, font: "13px/1.45 'Segoe UI', system-ui", padding: 14 }}>
      <div style={{ fontSize: 12, color: muted, marginBottom: 8 }}>Sagax</div>
      <div style={{ display: "flex", gap: 12 }}>
        <Avatar sample={sample} size={44} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{sample.bot} · {sample.subtitle}</div>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 2, color: dark ? "#d4d4d4" : "#1f2937" }}>{body}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {labels.map((label) => (
          <div key={label} style={{ flex: 1, textAlign: "center", padding: "6px 4px", borderRadius: 4, background: dark ? "#3a3a3a" : "#e5e5e5", whiteSpace: "nowrap" }}>{label}</div>
        ))}
      </div>
    </div>
  );
}

function UpdatesRow({ sample }: { sample: Sample }) {
  const { body, labels, open } = words(sample);
  return (
    <div data-updates-row style={{ width: 390, padding: "14px 16px", background: dark ? "#111418" : "#ffffff", borderBottom: `1px solid ${line}`, color: ink, font: "14px/1.4 -apple-system, system-ui", display: "flex", gap: 12 }}>
      <Avatar sample={sample} size={40} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 16 }}>{sample.bot}</div>
        <div style={{ whiteSpace: "pre-wrap", color: muted }}>{body}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {labels.map((label) => (
            <div key={label} style={{ height: 32, padding: "0 14px", borderRadius: 16, background: sample.color, color: "#fff", fontWeight: 600, fontSize: 13, display: "grid", placeItems: "center", whiteSpace: "nowrap" }}>
              {open ? "Ouvrir" : label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Gallery() {
  return (
    <div data-gallery-sample="notification-context" style={{ display: "grid", gridTemplateColumns: "repeat(3, 400px)", gap: 24, padding: 24, background: dark ? "#0b0e13" : "#e9ecf1", alignItems: "start" }}>
      {[capture, legible].map((sample) => (
        <div key={sample.id} style={{ display: "contents" }}>
          <MacBanner sample={sample} />
          <WindowsToast sample={sample} />
          <UpdatesRow sample={sample} />
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
