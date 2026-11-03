# Sagax desktop mascot: voice call "mascot mode" and a virtual pointer

Backlog design for the full "ChatGPT Pets + Voice + pointer" experience of the Sagax desktop mascot: a call rail beside the character with captions, task chips and a hotkey, then a virtual pointer and consented computer interaction from the mascot. Asked by the owner on 2026-10-08. Sources: https://learn.chatgpt.com/docs/pets, https://learn.chatgpt.com/docs/whats-new, https://github.com/farzaa/clicky. The rest of this file is the design note as written.


Research and design note, 2026-10-08. Asked by the owner on 2026-10-08. No code changed.
Repo read: `pulsatrixtechnologies/sagax`, main clone `/Users/Repository/pti/Sagax/main` at `9d404a7cf`.

---

## Part A. Research: what "ChatGPT mascot mode" is

### A.1 What it actually is (public facts, dated)

There is no OpenAI feature literally named "mascot mode". The closest thing, and almost certainly
what the owner saw, is **ChatGPT Pets** in the ChatGPT desktop app combined with **ChatGPT Voice on desktop**.

| Date | Fact | Source |
|---|---|---|
| May 2026 | Pets added to the ChatGPT desktop app (macOS, Windows): an animated pixel-art companion that floats above every other window and shows what ChatGPT is doing (processing, waiting, finished). | ETV Bharat 2026-09-14; penchan.co guide |
| 2026-07-08 | GPT-Live, OpenAI's full-duplex voice generation (listens and speaks at the same time). | justainews / web search summary |
| 2026-07-23 | ChatGPT Voice in the desktop app: "Control your computer and direct multiple agents running in ChatGPT Work or Codex, using just your voice." macOS + Windows, Plus/Pro/Business/Edu/Enterprise. | OpenAI community announcement 2026-07-23; TechCrunch 2026-07-24 |
| 2026-07-31 | "Your pets have found a shortcut to ChatGPT Voice. In the desktop app, click your pet to open Voice, check on work, and approve or stop tasks without missing a beat." | @ChatGPT on X (status 2083287694852112400, page 403 to fetch, text from search index), Digg, Threads |
| 2026-09-07..11 | "Start a quick chat from your pet": type a request or start a voice conversation from the floating Pets controls; Option+Space (macOS) / Windows+Alt+P (Windows) shows the controls and focuses Quick Chat; "Mini" = the controls without a pet. | learn.chatgpt.com What's new |

### A.2 Layout (what is documented)

- **Character**: a sprite companion that floats above other app windows, by default in a screen corner;
  draggable anywhere; position and choice persist across launches. Size adjustable
  (Settings > Pets > Customize > Pet size; Reset). No pixel size is published.
- **Controls sit below the pet** (hover to reveal): a pencil (Quick Chat input box), a **voice icon**
  (starts Voice), a **bell** (activity tray). The tray lists threads with a status: Running,
  Needs input, Ready, Blocked (priority: Needs input > Blocked > Ready > Running); a chevron collapses it;
  selecting a thread opens it in the main app. "The activity tray is separate from system notifications."
- **Status beside the pet**: guides describe a status/speech bubble next to the pet (Codex app article:
  the pet "moves as if thinking while Codex works, looks at the user while waiting, and shows a speech
  bubble when it needs a review"). Exact side and offset not documented.
- **Computer Use (macOS)**: the Computer Use picture-in-picture window "can attach to your pet"; when you
  move the pet, the window follows. So OpenAI also docks things *beside* the character, not over it.
- **Appshots (macOS)**: press both Command keys; the frontmost window (screenshot + accessible text)
  goes to the visible pet and starts a chat. In Voice, saying "Take a look at this" does the same when
  Screen context is on (needs Screen & System Audio Recording + Accessibility).
- **Custom pets**: sprite sheet, transparent PNG/WebP, exactly 1536 x 1872 px, at most 20 MiB, with a
  `pet.json`; rows per state (Idle, Running, Failed, Waiting, Review, ...). Reduced motion: "the pet uses a
  still frame instead of sprite animation."
- **Hide**: right-click > Hide, `/pet`, command menu, Settings > Pets. A user complaint (X) shows the
  floating bar overlaps all apps; setting "Settings > Mini & Pets > Hide mini".

### A.3 Voice behaviours (documented)

- Start: "Start voice chat" in a thread, "Start new voice chat" in a new one, the pet click, the pet's
  voice icon, or a configurable **Voice chat hotkey** (Settings > Voice; distinct from dictation).
- End: "Stop voice chat" control. Mute: microphone control on screen (no official mute hotkey found).
- Interruptions: you can cut ChatGPT mid-answer, steer, ask progress while tasks run (full duplex).
- Voice starts separate tasks, reports progress, blockers and results back; same permissions as the tasks.
- **One voice chat at a time** across the desktop app; another window's active chat blocks a new one.
- Transcript: after the call ends, it is added to the chat history.

### A.4 Not public (say so to the owner)

The exact pixel sizes and spacing of the pet controls; what is drawn beside the pet *during* a voice call
(live captions or not, waveform or not); the per-phase voice animations (listening, thinking, speaking)
of the pet; behaviour when the user clicks into another app (the docs only say you "keep working in other
apps"); multi-display behaviour; whether the pet points at anything. OpenAI's help article
(help.openai.com/en/articles/20001274) returned 403. **OpenAI's pet does not point at the screen**: no
source shows a pet-driven pointer; Computer Use has its own PiP window instead.

### A.5 Comparable products

- **Clicky (farzaa/clicky, now HeyClicky; Windows port tekram/clicky-windows)**: the reference for
  "point at the screen". macOS menu-bar app, push-to-talk on Control+Option, takes a screenshot with
  your question, Claude answers aloud (AssemblyAI STT, ElevenLabs TTS), and a **full-screen transparent
  NSPanel overlay draws a blue cursor that flies to the UI element** being discussed, across multiple
  monitors. The model emits `[POINT:x,y:label:screenN]`. It guides; it does not operate (newer agent mode
  aside). Permissions: Microphone, Accessibility (hotkey), Screen Recording / ScreenCaptureKit.
- **Microsoft Copilot "Mico"**: an abstract blob avatar in Copilot voice mode, launched October 2025,
  changing colour/shape/expression with tone; deliberately non-human. Being removed from voice mode
  "in waves" (reported ~August 2026), moved to Learn Live. Lesson: a character must stay optional and
  quiet; no documented on-screen highlighting.
- **Grok companions (Ani etc.)**: 3D anime companions with lip-sync, mobile apps only; status unclear in
  2026 (reports of retirement of the 3D mode, unconfirmed). No desktop presence.
- **Siri, macOS 27 "Golden Gate"**: Siri AI lives in the Spotlight bar and expands for the conversation;
  the Apple Intelligence edge glow is system UI with no public API. Not a desktop character.
- **openhuman issue #5425 (2026-08-06)**: a useful placement rule: the reply opens toward the screen
  (rightward when docked left, leftward when docked right, upward when docked at the bottom), a summary
  beside the mascot with "read more".

### A.6 Images

- Clicky demo (pointer flight): https://github.com/farzaa/clicky/raw/main/clicky-demo.gif
- ChatGPT/Codex pet on screen (note.com, 2026-08-11): https://assets.st-note.com/img/1786404085-1ChnU0RxMAgTo4uWfcpHmdQV.png
- Default pet beside the app (penchan.co): https://penchan.co/img/inline/codex-pets-inline-1-default-pet.webp
- "Building with ChatGPT Voice" video: https://www.youtube.com/watch?v=E0ZMOschrTU
  (thumbnail https://us1.discourse-cdn.com/openai1/original/4X/7/e/7/7e74265b3016d1428f878f65b653091b03b884e3.jpeg)

### A.7 Sources

Best three: (1) https://learn.chatgpt.com/docs/pets (official Pets doc: controls below the pet, voice icon,
tray, hotkeys, PiP attaches to pet), (2) https://learn.chatgpt.com/docs/whats-new and
https://learn.chatgpt.com/docs/features/voice (dated release notes; voice start/stop, hotkey, one call),
(3) https://github.com/farzaa/clicky (pointer overlay pattern and POINT tag).
Others: https://techcrunch.com/2026/07/24/openais-new-voice-mode-makes-it-to-the-chatgpt-desktop-app/ ,
https://community.openai.com/t/chatgpt-voice-is-now-in-the-desktop-app/1388031 ,
https://www.etvbharat.com/en/technology/openai-adds-pets-feature-to-chatgpt-desktop-app-what-is-it-and-how-to-setup-enn26091401158 ,
https://penchan.co/en/ai/coding/codex-pets/ , https://note.com/pure_pothos9807/n/n3c9983ee7afc ,
https://x.com/ChatGPT/status/2083287694852112400 , https://github.com/tinyhumansai/openhuman/issues/5425 ,
https://www.tomsguide.com/ai/copilot/forget-clippy-meet-mico-microsofts-friendlier-face-for-copilots-fall-release ,
https://www.kucoin.com/news/flash/microsoft-phases-out-mico-the-yellow-ai-character-in-copilot-voice-mode ,
https://community.openai.com/t/custom-chatgpt-avatars-for-voice-mode/1399731 (orb, not a character, is the official voice visual).

---

## Part B. What Sagax has today

### B.1 The mascot

- One transparent, frameless, always-on-top window per floating bot (`electron/floating-bot-window.mjs`,
  `alwaysOnTop "floating"`, `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`,
  `setIgnoreMouseEvents(true, { forward: true })` on transparent pixels, toggled when the pointer is over the art).
- The app page is the brain (`FloatingBots.tsx`, `brain.ts`); windows get a validated snapshot
  (`protocol.ts`) and send events back. Clips are pure functions of time (`clips.ts`), picked by
  `behavior.ts` (nothing faster than ~4 Hz). Stage sized by `fit.ts` (`mascotStage`); home room for the
  quick chat by `window-frame.ts` (`chatHomeSize`), anchored on the character's bottom-right corner.
- Balloon: drawn above the character, z-index 2; **effects are z-index 3, inside the mascot's own
  window**, so today they render over or around the art within the stage, not in a dedicated side area.
- Native context menu at the pointer (`floating-bots:menu`). No global hotkey anywhere in `electron/`
  (`globalShortcut` unused).

### B.2 The mascot call (commit 349335973, 2026-10-02, then trimmed)

- The call is the app's single voice-mode call (`LiveCallEngine` run once by `CallEngineHost`, published
  in `live-call-store.ts`); one call at a time across app and mascots (`lib/call.ts`). Started from the
  balloon header's call button or the menu's Call (`mascot-call.ts`, `runMascotCallEvent`, actions only
  reach the mascot's own bot's call).
- `MascotCall.tsx` today: a 36 px pill **under the feet** (timer, push-to-talk when enabled, mute, red end).
  Since the commit, Settings and Transcript moved to "the call stage in the chat"; the mascot card now only
  shows a note/notice (retry). So **there is no live caption or transcript beside the mascot today.**
- Levels on their own channel `floating-bots:level` (20 Hz, rounded): the mascot bounces with the bot's
  voice (`--fb-voice`) and leans in while the person talks (`data-call`); a click on it interrupts.
- Phases available: `connecting | listening | hearing | thinking | speaking | interrupted | held | ended`
  (`src/lib/voice-mode/call-machine.ts`). `call.line` carries the live heard text or the bot's caption.
- Voice mode (`docs/voice-mode-xai.md`): xAI is only STT/TTS; the bot stays the brain with all its tools,
  approvals, memory. So a call turn can already use computer use. Microphone is the app page's.

### B.3 Computer use (`docs/computer-use-integration.md`, 2026-08-12)

- CUA (`cua-driver`) is the only local desktop-control provider, spawned by Electron main
  (`electron/cua.mjs`) so the TCC grant is Sagax's. Tools: screenshot, get_window_state (AX + vision,
  with a `query`), click/drag/scroll/type/press/hotkey, move_cursor, launch_app, zoom, etc.
- The driver already ships an **agent cursor overlay**: `set_agent_cursor_enabled`,
  `set_agent_cursor_motion` (`cursor_color`, `cursor_label`, `cursor_icon` arrow/teardrop, glide, arc,
  spring, `idle_hide_ms`), `set_agent_cursor_style` (bloom, gradient), `move_cursor` with `cursor_id`
  (allowlisted in `electron/lent-screen-tools.mjs`). Sagax does not use it for "pointing" anywhere.
- Server mode: the desktop bridge (`electron/desktop-bridge.mjs`, `server/desktop/desktop-bridge-tools.ts`)
  exposes `computer_list_tools` / `computer_use` on the person's own screen, outbound only, each action
  logged in the computer's activity log (action and target only). `server/computer/computer-control.ts`: the
  person can take the hands; the bot can only ask (`requestHelp`), actions refused while held.
  `server/computer/auto-computer.ts`: Works on Auto picks cloud / this_computer / local_vm.
- Approval modes apply to computer actions as to every tool (`approval-mode`, `approval-trusted-mode`).

### B.4 What "point on the screen" adds

A **visible virtual pointer, separate from the real mouse**, that the bot flies to a target with a label
("Click Export here"), plus highlight/spotlight of a region and step markers for "show me how". It changes
nothing on screen, so it can run under an observe-level consent; it only needs to *find* the target
(screenshot + AX locator). Real control stays the existing computer-use path, with consent, and the same
pointer then visibly precedes each real click so the person sees the bot's hand.

---

## Part C. Design

### Slice 2: the call from the mascot, "mascot mode" UI

**Scope.** A call started from the mascot (click on mascot while idle opens the call, menu Call, balloon
button, global hotkey) shows a ChatGPT-Pets-like UI: controls under the feet (kept), and a **call rail
beside the character** with status, live captions, a compact transcript, task/approval chips. Polished
per-phase animations on every character (owl, original shape, Trombi, Bunbu). Same single call engine.

**UI spec.**
- Rail side: computed by a pure `railPlacement(stageBox, workArea)`: open toward the larger free side of
  the display's work area (left or right of the stage box); if neither side has 220 px, open above
  (below if near top). Gap 10 px from the character's art box, never overlapping it (the art box, not the
  stage). Vertically aligned on the head (top of rail = head top - 8 px), clamped inside the work area.
  Flips side with a 180 ms cross-fade when the mascot is dragged past the midpoint (hysteresis 40 px).
- Rail content (top to bottom), width 240 to 300 px, radius 16, app theme tokens, shadow as the pill:
  1. Status chip (22 px): dot + "Listening", "Hearing you", "Thinking", "Speaking", "On hold", "Muted",
     "Reconnecting" (from `phaseLabel`).
  2. Live captions: the bot's words revealed word by word in sync with TTS playback (needs a caption
     progress value); the person's words in a lighter tone while `hearing`; at most 3 lines, older lines
     fade up and out (240 ms). 15 px, line height 1.35.
  3. Task chips (when the bot runs tools in the call): "Working: Export report" with a spinner;
     "Needs you: allow click in Excel?" with Allow / Stop buttons (mirrors "approve or stop tasks").
  4. Expand control: "Transcript" opens the compact transcript (max 360 x 320, scroll, same bubbles as
     the app) in the same rail; "Open in app" opens the thread.
- Rail idle behaviour: during long silences the captions collapse to the status chip only after 6 s;
  hovering restores them. Captions toggle in the pill (CC button) and in Settings.
- Pill under the feet (36 px, kept): timer, CC, push-to-talk (if enabled), mute, hold, red End.
- Phase animations (all via `clips.ts`, under the 4 Hz rule, reduced motion = still pose + text):
  connecting: soft three-dot "ringing" beside the head, mascot looks up; listening: slow breathing,
  eyes toward the rail side, halo ring behind the art at 12 % opacity breathing on a 4 s cycle;
  hearing: lean-in (exists) + halo scaled by mic level; thinking: "ponder" clip (eyes up, small orbit
  dots on the rail side of the head, never over the face); speaking: bounce (exists) + mouth/beak/ear
  sync to bot level; interrupted: 250 ms startle; held: art dims to 60 %, small "z"; ended: wave clip,
  rail collapses toward the mascot in 200 ms. Effects live beside the art (the rail side), not over it.
- Click away: the mascot window is non-focusable; the call and rail stay; focus never moves.
- Multi-display: rail on the mascot's display, recomputed on `display-metrics-changed`.
- Hotkey (default Control+Option+Space on macOS, Ctrl+Alt+Space on Windows/Linux; configurable;
  avoid Option+Space which ChatGPT uses): press = start a call with the front mascot's bot (shows the
  mascot if hidden) or toggle mute during a call; hold more than 400 ms = push-to-talk; a second
  shortcut (unset by default) ends the call.

**Electron architecture.** The rail lives in the **mascot window** (it is interactive): at call start
the window grows once to a `callHomeSize` room (like `chatHomeSize`, anchored so the mascot does not
move), shrinks back at the end. New main module `electron/mascot-hotkey.mjs` (globalShortcut, registered
only while a mascot is shown; reports conflicts). Protocol: `snapshot.call` gains `captionProgress`,
`tasks[]` (id, label, state, approvalId), `rail` prefs; new call actions `approve`, `deny`, `stop-task`,
`captions`, `open-thread`; main sanitizes them like today. Levels channel unchanged.

**Server pieces.** None new for voice; approvals already exist: the brain maps pending approvals of the
call's thread to `tasks[]` and `approve`/`deny` reuse the in-chat approval route. Caption timing comes
from the client TTS player (already client side).

**Tests.** `rail-placement.test.ts` (sides, flip hysteresis, edges, no overlap with art box, multi
display), `clips` tests for new clips (rate cap, reduced motion), `mascot-call.test.ts` (approve/stop
reach only this bot's call, hotkey start/mute), `mascot-hotkey.node-test.mjs`, sanitizer tests in
`floating-bot-window.test.mjs`; `verify-mascot-chat.mjs` call leg: rail gap and no overlap, one resize
only, no mascot jump, frame budget, click-through outside rail/pill; `verify-voice-mode.ts` stays 42/42.

**Risks.** Window growth near screen edges (clamping moving the mascot); TTS word timing drift;
hotkey conflicts (ChatGPT, Raycast, input sources); caption load on low-end GPUs (keep 30 fps cap).

**Estimate.** 7 days (rail + placement 2, clips per character 2, hotkey 1, approvals chips 1, verify 1).

### Slice 3: virtual pointer and full computer interaction from the mascot

**Scope.** The bot can point at things on the person's screen (pointer + label), highlight or spotlight
a region, run a "show me how" sequence (point, explain, wait for the person to do it), and, with consent,
do it itself through the existing CUA path with the same pointer leading each real action. Works in a
call and in chat.

**UI spec.**
- Pointer: teardrop in the bot's colour (`shared/mascot-colors.ts`), 28 px, white 2 px rim, soft bloom.
  It leaves from the mascot (the mascot plays a "point" clip toward the target), flies on a curved
  arc, 450 to 700 ms by distance, spring settle, then idles with a slow 2 s pulse.
- Label pill beside the pointer (right, flips near edges), max 260 px, 13 px, theme tokens; the same
  text appears in the mascot's rail captions.
- Highlight: rounded rectangle ring (2 px, bot colour, 6 px corner) around the target bounds with a 1.6 s
  glow pulse. Spotlight (optional): screen dimmed to 35 % except the target. Steps: numbered badges 1..n.
- Control state ("Sagax is using your computer"): a 3 px border in the bot colour around each display,
  a Stop button in the rail, Stop also on the hotkey and on Escape pressed twice.
- Pointer hides after 8 s idle or on `clear_pointer`; never covers the real cursor (offset 24 px if the
  real cursor is within 40 px).

**Electron architecture.**
- `electron/pointer-overlay.mjs`: **one overlay window per display**, created lazily, destroyed after
  30 s unused. `BrowserWindow` transparent, frameless, `focusable: false`, `hasShadow: false`,
  `type: "panel"` on macOS, `setIgnoreMouseEvents(true)` permanently (never interactive: all controls stay
  in the mascot window), `setAlwaysOnTop(true, "screen-saver")`, `setVisibleOnAllWorkspaces(true,
  { visibleOnFullScreen: true })`, bounds = `display.bounds` (covers menu bar and Dock), shown with
  `showInactive()`. `setContentProtection(true)` so the bot's own screenshots never see its pointer
  (setting, because it also hides it from Zoom/Teams screen shares).
- Coordinates: main converts a target from screenshot pixels (driver `scale_factor`) to global DIP via
  `display.bounds` (and `screen.screenToDipPoint` on Windows), picks the display, sends local coords to
  that overlay. IPC: `pointer:show`, `pointer:highlight`, `pointer:steps`, `pointer:clear`, `pointer:control`.
- Option kept open: CUA's own agent cursor (`set_agent_cursor_*`) for the *real* actions, styled with
  the bot colour, so the pointer overlay hands off to it during an act. Must be verified that it renders
  identically and does not move the real cursor.

**Server pieces.**
- Tools (solo and through the desktop bridge as new operations, not CUA-forwarded):
  `point_at { target, label, style: pointer|highlight|spotlight, hold_ms }` where `target` is one of
  `{ x, y, screenshot_id }`, `{ element_token }` (from `get_window_state`), or `{ description }`;
  `show_me { steps: [{ target, label, say? }], mode: "guide" | "do" }`; `clear_pointer {}`.
- Locator for `description`: first CUA `get_window_state` with `query` (AX), else screenshot + the bot's
  vision grounding; returns bounds and a confidence; low confidence answers "Is it this one?" instead of
  pointing firmly.
- "guide" advances when the person says "ok/next" in the call, clicks Next in the rail, or the next
  screenshot shows the expected change (poll at most every 1.5 s, CUA observation only).
- "do": each step becomes the existing `computer_use` actions; the pointer flies to the target first,
  the action runs 300 ms later.
- Consent: pointing = observe level (needs this computer's screen sharing on for this bot, as
  screenshots do; no new approval). Acting = the bot's approval mode as today, plus a per-task
  "Let Sagax do it" consent from the rail; `computer-control.ts` hold stops everything; never act on
  instructions read from the screen without the person's spoken or clicked consent.
- Audit: every point/highlight/step written to the computer's activity log (`lending-activity.mjs`):
  action, label, app name, no screenshot; acts already logged. `shared/tool-surface.ts`: pointer tools
  are not screen-touching.

**Tests.** Coordinate mapping unit tests (Retina 2x, 1x external, negative-origin left display,
Windows 125/150 %), overlay window flags node test, tool schema/sanitizer tests (server and
`desktop-bridge.node-test.mjs`), locator fallback tests with fixtures, consent tests (point without
approval, act refused while held or without consent), real-Electron `scripts/verify-pointer.mjs`
(overlay click-through, above a fullscreen app, two displays, content protection on a capture).

**Risks.** macOS Screen Recording (monthly re-prompt on 15+) and Accessibility grants; overlays above
native fullscreen Spaces and exclusive-fullscreen games (may not show); Windows mixed-DPI conversions;
Linux Wayland forbids global absolute overlays (GNOME Wayland: fall back to CUA cursor or no pointer);
content protection hides the pointer from screen shares; mis-grounding (pointing at the wrong button);
prompt injection from on-screen text; privacy (screenshots go to the bot's model provider, Loi 25
notice); battery if overlays stay alive.

**Estimate.** 11 days (overlay + mapping 3, tools + bridge + locator 3, show_me guide/do 2, consent +
audit 1, mascot point clip 0.5, verify + multi-display tests 1.5).

### Open questions for the owner

1. Must the pointer work over native fullscreen apps and games, or is "above normal windows and
   fullscreen Spaces where macOS allows it" enough?
2. Should the mascot call coexist with the main window's call bar (same call shown in both) or replace
   it while the mascot is on screen?
3. Click on the mascot when idle: open the call (ChatGPT behaviour) or keep the balloon (today)? Call on
   double-click?
4. Default hotkey: Control+Option+Space ok? Mute vs push-to-talk on the same key?
5. Should the pointer be visible in screen shares (no content protection) or hidden from the bot's own
   screenshots (content protection)? They exclude each other.
6. Consent for acting: per task, per app, or a timed "you can drive for 10 minutes"?
7. Server mode: may an organization bot point/act on a person's screen from a call, or solo only first?
8. Use CUA's agent cursor for real actions (one cursor look) or our overlay for both?
9. Captions on by default beside the mascot?
10. Linux Wayland: acceptable to ship without the pointer there?
