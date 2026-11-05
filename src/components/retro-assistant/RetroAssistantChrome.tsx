import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import type { OwlAvatarHandle } from "@/components/OwlAvatar";
import type { OwlGaze } from "@/lib/owl/owl-art";
import type { MascotSkinId } from "../../../shared/mascot-skins";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { AssistantPose, IdlePhase, RetroCharacter, RetroTip } from "./logic";
import { BulbIcon, Envelope, Notebook, Puff, TapMarks, Zzz } from "./RetroArt";
import { Win98Button } from "./Win98";
import { AssistantArt, type CustomArtUrls } from "./AssistantArt";
import type { Act, Balloon, BalloonModel } from "./retro-assistant-shared";

export interface RetroAssistantChromeProps {
  reduced: boolean;
  language: string;
  detached: boolean;
  leaving: boolean;
  character: RetroCharacter;
  pose: AssistantPose;
  mood: IdlePhase;
  act: Act | null;
  box: { width: number; height: number };
  at: { right: number; bottom: number };
  balloonBelow: boolean;
  look: { color: string; skin: MascotSkinId };
  gaze: OwlGaze | undefined;
  custom: CustomArtUrls;
  owl: RefObject<OwlAvatarHandle | null>;
  busy: boolean;
  planTravel: boolean;
  planExit: "puff" | "vanish";
  envelopes: number[];
  bulb: RetroTip | null;
  balloon: Balloon | null;
  model: BalloonModel | null;
  query: string;
  setQuery: (value: string) => void;
  namesAria: string;
  soundsClick: () => void;
  openTip: (tip: RetroTip | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onCharacterKey: (event: ReactKeyboardEvent) => void;
  onSearch: (event: FormEvent) => void;
  onAskOptions: () => void;
  children?: ReactNode;
}

/** In-page stage, character button and speech balloon. */
export function RetroAssistantChrome(props: RetroAssistantChromeProps) {
  const {
    reduced, language, detached, leaving, character, pose, mood, act, box, at, balloonBelow,
    look, gaze, custom, owl, busy, planTravel, planExit, envelopes, bulb, balloon, model,
    query, setQuery, namesAria, soundsClick, openTip, onPointerDown, onPointerMove, onPointerUp,
    onPointerCancel, onContextMenu, onCharacterKey, onSearch, onAskOptions, children,
  } = props;

  const askBox = (autoFocus: boolean) => (
    <form className="r98-ask" onSubmit={onSearch}>
      <label className="r98-ask-label" htmlFor="r98-ask-input">{t("retro.ask.label")}</label>
      <input
        id="r98-ask-input"
        className="r98-field"
        value={query}
        placeholder={t("retro.ask.placeholder")}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus={autoFocus}
        autoComplete="off"
      />
      <div className="r98-row">
        <Win98Button onClick={onAskOptions}>{t("retro.ask.options")}</Win98Button>
        <Win98Button type="submit" className="r98-default">{t("retro.ask.search")}</Win98Button>
      </div>
    </form>
  );

  const body = model ? (
    <>
      {model.tipHead && (
        <div className="r98-tip-head">
          <BulbIcon size={18} />
          <strong>{t("retro.tip.title")}</strong>
        </div>
      )}
      {model.text && <p>{model.text}</p>}
      {model.question && <p className="r98-question">{model.question}</p>}
      {model.bullets.length > 0 && (
        <ul className="r98-bullets">
          {model.bullets.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => { soundsClick(); item.run(); }}>
                <span className="r98-dot" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {model.buttons.length > 0 && (
        <div className="r98-row r98-row-3">
          {model.buttons.map((item) => (
            <Win98Button key={item.id} className={item.primary ? "r98-default" : undefined} onClick={item.run}>{item.label}</Win98Button>
          ))}
        </div>
      )}
      {model.ask && askBox(balloon?.kind !== "guess")}
    </>
  ) : null;

  return (
    <div className="r98-root" data-reduced={reduced ? "" : undefined} lang={language}>
      {!detached && (
        <div
          className={cn("r98-stage", act && `r98-act-${act.name}`, `r98-mood-${mood}`, `r98-char-${character}`)}
          style={{ right: at.right, bottom: at.bottom, width: box.width, height: box.height }}
          data-retro-owl=""
          data-character={character}
          data-pose={pose}
          data-mood={mood}
        >
          <span className="r98-floor" aria-hidden="true" />
          {bulb && !balloon && !leaving && (
            <button type="button" className="r98-bulb" title={t("retro.bulb")} aria-label={t("retro.bulb")} onClick={() => openTip(bulb)}>
              <BulbIcon />
            </button>
          )}
          <div className="r98-body">
            <button
              type="button"
              className="r98-owl"
              aria-label={namesAria}
              aria-haspopup="menu"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onContextMenu={onContextMenu}
              onKeyDown={onCharacterKey}
            >
              <AssistantArt
                ref={owl}
                character={character}
                pose={pose}
                reduced={reduced}
                look={{ color: look.color, skin: look.skin }}
                gaze={gaze}
                custom={custom}
              />
            </button>
            {character === "owl" && busy && <Notebook />}
            {character === "owl" && mood === "doze" && planTravel && <Zzz />}
            {act?.name === "tap" && <TapMarks />}
          </div>
          {character === "owl" && envelopes.map((id) => (
            <span key={id} className="r98-envelope">
              <Envelope />
            </span>
          ))}
          {leaving && planExit === "puff" && <Puff />}
        </div>
      )}

      {!detached && balloon && body && (
        <div
          role="dialog"
          aria-label={t("retro.aria.balloon")}
          className={cn("r98-balloon", balloonBelow && "r98-balloon-below")}
          style={
            balloonBelow
              ? { right: Math.max(8, at.right - 6), top: window.innerHeight - at.bottom + 12 }
              : { right: Math.max(8, at.right - 6), bottom: at.bottom + box.height + 8 }
          }
        >
          <span className="r98-balloon-shade" aria-hidden="true" />
          <div className="r98-balloon-face">
            <span className="r98-tail" aria-hidden="true" />
            {body}
          </div>
        </div>
      )}

      {children}
    </div>
  );
}
