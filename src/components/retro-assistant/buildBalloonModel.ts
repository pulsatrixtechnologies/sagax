import type { Dispatch, SetStateAction } from "react";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { tipById, type RetroTip, type TipAction } from "./logic";
import type { Balloon, BalloonModel } from "./retro-assistant-shared";

export function buildBalloonModel(args: {
  balloon: Balloon | null;
  welcomeKey: LocaleKey;
  openTip: (tip: RetroTip | null) => void;
  pickTip: () => RetroTip | null;
  runAction: (action: TipAction) => void;
  dismiss: (entry: string) => void;
  setBalloon: Dispatch<SetStateAction<Balloon | null>>;
  setDialog: Dispatch<SetStateAction<"options" | "gallery" | "custom" | null>>;
}): BalloonModel | null {
  const { balloon, welcomeKey, openTip, pickTip, runAction, dismiss, setBalloon, setDialog } = args;
  if (!balloon) return null;
  if (balloon.kind === "welcome") {
    return {
      question: t(welcomeKey),
      bullets: [
        { id: "tip", label: t("retro.welcome.tip"), run: () => openTip(pickTip()) },
        { id: "look", label: t("retro.welcome.look"), run: () => { setBalloon(null); setDialog("gallery"); } },
        { id: "none", label: t("retro.welcome.nothing"), run: () => setBalloon(null) },
      ],
      buttons: [],
      ask: true,
    };
  }
  if (balloon.kind === "tip") {
    const tip = balloon.tip;
    return {
      tipHead: true,
      text: t(tip.text),
      question: tip.action ? t("retro.tip.showMe") : t("retro.tip.another"),
      bullets: [],
      buttons: [
        { id: "yes", label: t("retro.button.yes"), primary: true, run: () => (tip.action ? runAction(tip.action) : openTip(pickTip())) },
        { id: "no", label: t("retro.button.noThanks"), run: () => setBalloon(null) },
        { id: "never", label: t("retro.button.never"), run: () => { dismiss(tip.id); setBalloon(null); } },
      ],
    };
  }
  if (balloon.kind === "guess") {
    const guess = balloon.guess;
    return {
      question: t(guess.question),
      bullets: [
        { id: "help", label: t(guess.help), run: () => openTip(guess.kind === "idle" ? pickTip() : tipById(guess.tip) ?? null) },
        { id: "skip", label: t(guess.skip), run: () => setBalloon(null) },
        { id: "never", label: t("retro.guess.never"), run: () => { dismiss(`guess:${guess.kind}`); setBalloon(null); } },
      ],
      buttons: [],
      ask: true,
    };
  }
  return {
    question: balloon.tips.length ? t("retro.results.found") : t("retro.results.none"),
    bullets: balloon.tips.slice(0, 5).map((tip) => ({ id: `r:${tip.id}`, label: t(tip.text), run: () => openTip(tip) })),
    buttons: [],
    ask: true,
  };
}
