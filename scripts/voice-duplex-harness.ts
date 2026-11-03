// Scripted acceptance for issue #292: utterance A, barge-in, utterance B.
// Drives the real call machine and duplex admit (no xAI key). Duplex on:
// B replaces A (one interrupt, at send time while A is thinking), only B's
// answer is spoken and the steer queue is empty. Flag off: A then
// B stack, which is today's typed-chat-on-a-call behaviour.
import { INITIAL_CALL, step, type CallEffect, type CallEvent, type CallState } from "../src/lib/voice-mode/call-machine.ts";
import { admitDuplexSend } from "../server/voice/voice-call-duplex.ts";
import {
  cancelSpeech,
  createSpeechFence,
  noteUtteranceSent,
  settleReplies,
} from "../src/lib/voice-mode/speech-fence.ts";

const ANSWERS: Record<string, string> = {
  "tell me a story": "Once upon a time.",
  "what about the weather": "It is sunny.",
};

export interface DuplexHarnessResult {
  spoken: string[];
  sends: string[];
  interrupts: number;
  queuedAfter: number;
}

function run(events: CallEvent[], from: CallState) {
  let state = from;
  const effects: CallEffect[] = [];
  for (const event of events) {
    const out = step(state, event);
    state = out.state;
    effects.push(...out.effects);
  }
  return { state, effects };
}

export function runVoiceDuplexHarness(opts: { duplex: boolean }): DuplexHarnessResult {
  const spoken: string[] = [];
  const sends: string[] = [];
  let queue: string[] = [];
  let interrupts = 0;
  let state: CallState = { ...INITIAL_CALL, duplex: opts.duplex };

  state = run([{ type: "connected" }], state).state;

  const first = run([
    { type: "speech-candidate" },
    { type: "speech-start" },
    { type: "speech-end" },
    { type: "utterance", text: "tell me a story" },
  ], state);
  state = first.state;
  for (const effect of first.effects) {
    if (effect.type === "send") sends.push(effect.text);
  }
  state = run([{ type: "bot-busy", busy: true }], state).state;

  const barged = run([{ type: "speech-candidate" }, { type: "speech-start" }], state);
  state = barged.state;
  for (const effect of barged.effects) {
    if (effect.type === "interrupt-bot") interrupts += 1;
    if (effect.type === "cancel-speech") spoken.length = 0;
  }

  const second = run([
    { type: "speech-end" },
    { type: "utterance", text: "what about the weather" },
  ], state);
  state = second.state;
  let latest = "";
  for (const effect of second.effects) {
    if (effect.type === "send") {
      latest = effect.text;
      sends.push(effect.text);
    }
  }

  // Talking while the bot thinks no longer interrupts at speech-start
  // (#293, Review 3): the send is classified first, and a replace carries
  // the interrupt of the in-flight turn.
  const admit = admitDuplexSend({
    duplex: opts.duplex,
    botBusy: state.botBusy,
    stopping: interrupts > 0,
    queued: queue.length > 0,
  });

  if (admit.action === "replace") {
    if (admit.interrupt && interrupts === 0) interrupts += 1;
    queue = [];
    let fence = cancelSpeech(createSpeechFence(), ANSWERS[sends[0] ?? ""] ?? "");
    fence = noteUtteranceSent(fence);
    const userA = { id: "uA", role: "user" as const, kind: "text", text: sends[0] ?? "" };
    const userB = { id: "uB", role: "user" as const, kind: "text", text: latest };
    const dying = { id: "bA", role: "bot" as const, kind: "text", text: ANSWERS[sends[0] ?? ""] ?? "" };
    const reply = { id: "bB", role: "bot" as const, kind: "text", text: ANSWERS[latest] ?? "", requestMessageId: "uB" };
    const late = settleReplies(fence, [userA, userB, dying], ["bA"]);
    const next = settleReplies(late.fence, [userA, userB, dying, reply], ["bB"]);
    spoken.push(...late.speak.map((item) => item.text), ...next.speak.map((item) => item.text));
  } else {
    if (latest) queue.push(latest);
    const firstAnswer = ANSWERS[sends[0] ?? ""];
    if (firstAnswer) spoken.push(firstAnswer);
    for (const item of queue) {
      const answer = ANSWERS[item];
      if (answer) spoken.push(answer);
    }
    queue = [];
  }

  return { spoken, sends, interrupts, queuedAfter: queue.length };
}
