// The live call's ears: xAI's streaming finalize semantics. A final chunk is
// one xAI will not revise, not the end of the utterance; only speech_final
// closes it, so the words after a first final chunk are not cut off or
// handed to the next turn.
import { describe, expect, it, vi } from "vitest";

import { LiveTranscriber } from "./stt-stream";
import { VAD_FRAME } from "./vad";

class Socket {
  readyState = 0;
  binaryType = "blob";
  finalizes = 0;
  requestIds: string[] = [];
  /** audio frames received */
  audio = 0;
  onFinalize: (socket: Socket) => void = () => {};
  private listeners: Record<string, Array<(event: unknown) => void>> = {};
  constructor(refuse = false) {
    setTimeout(() => {
      if (refuse) {
        this.readyState = 3;
        this.fire("error", {});
        return;
      }
      this.readyState = 1;
      this.fire("message", { data: JSON.stringify({ type: "ready" }) });
    }, 1);
  }
  addEventListener(type: string, cb: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  fire(type: string, event: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }
  transcript(text: string, final: boolean, speechFinal: boolean, confidence?: number, requestId?: string) {
    this.fire("message", { data: JSON.stringify({ type: "transcript", text, final, speechFinal, ...(confidence !== undefined ? { confidence } : {}), ...(requestId ? { requestId } : {}) }) });
  }
  send(data: string | ArrayBuffer) {
    if (typeof data !== "string") this.audio += 1;
    if (typeof data === "string" && JSON.parse(data).type === "finalize") {
      this.finalizes += 1;
      this.requestIds.push(JSON.parse(data).requestId);
      this.onFinalize(this);
    }
  }
  close() {}
}

async function ears(finalTimeoutMs = 300) {
  const socket = new Socket();
  const uploads: Blob[] = [];
  const transcriber = new LiveTranscriber({
    botId: "b-1",
    language: () => "en",
    threadId: () => "t-1",
    socket: () => socket as unknown as WebSocket,
    transcribe: async (_botId, audio) => { uploads.push(audio); return "uploaded"; },
    finalTimeoutMs,
  });
  expect(await transcriber.connect()).toBe(true);
  const speak = () => {
    transcriber.begin([]);
    transcriber.push(new Float32Array(VAD_FRAME).fill(0.05));
  };
  return { socket, transcriber, speak, uploads };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("LiveTranscriber finalize", () => {
  it("keeps two identified turns with their own words when the second finishes first", async () => {
    const { socket, transcriber, speak } = await ears();
    speak();
    const first = transcriber.finishHeard();
    speak();
    const second = transcriber.finishHeard();
    socket.transcript("Finalement, annule.", true, true, undefined, socket.requestIds[1]);
    socket.transcript("Cherche le billet.", true, true, undefined, socket.requestIds[0]);
    expect((await Promise.all([first, second])).map((heard) => heard.text)).toEqual(["Cherche le billet.", "Finalement, annule."]);
    transcriber.close();
  });

  it("reassembles probes in audio order and replaces each segment's partial with its final", async () => {
    const { socket, transcriber, speak } = await ears();
    speak();
    transcriber.probe();
    transcriber.push(new Float32Array(VAD_FRAME).fill(0.05));
    const finished = transcriber.finishHeard();
    socket.transcript("le billet de lundi", false, false, undefined, socket.requestIds[1]);
    socket.transcript("le billet de mardi", true, true, undefined, socket.requestIds[1]);
    let settled = false;
    void finished.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    socket.transcript("Cherche", true, true, undefined, socket.requestIds[0]);
    expect((await finished).text).toBe("Cherche le billet de mardi");
    transcriber.close();
  });

  it("retains a phrase repeated in two different identified segments", async () => {
    const { socket, transcriber, speak } = await ears();
    speak();
    transcriber.probe();
    socket.transcript("non pas lui", true, true, undefined, socket.requestIds[0]);
    transcriber.push(new Float32Array(VAD_FRAME).fill(0.05));
    const finished = transcriber.finishHeard();
    socket.transcript("non pas lui", true, true, undefined, socket.requestIds[1]);
    expect((await finished).text).toBe("non pas lui non pas lui");
    transcriber.close();
  });

  it("uploads the whole timed-out identified turn without draining the next turn's result", async () => {
    const { socket, transcriber, speak } = await ears(10);
    speak();
    const first = transcriber.finishHeard();
    socket.transcript("Cherche le billet", false, false, undefined, socket.requestIds[0]);
    expect((await first).text).toBe("uploaded");
    speak();
    const second = transcriber.finishHeard();
    socket.transcript("Annule", true, true, undefined, socket.requestIds[1]);
    socket.transcript("Cherche le billet de mardi", true, true, undefined, socket.requestIds[0]);
    expect((await second).text).toBe("Annule");
    transcriber.close();
  });

  it("never publishes or sends a suffix with its earlier segment missing, and recovers the whole audio on timeout", async () => {
    const { socket, transcriber, speak, uploads } = await ears(10);
    const partials: string[] = [];
    transcriber.onPartial((text) => partials.push(text));
    speak();
    transcriber.probe(); // the delayed segment contains: Ne fais pas ceci :
    transcriber.push(new Float32Array(VAD_FRAME).fill(0.05));
    const finished = transcriber.finishHeard();
    socket.transcript("envoie le courriel à Julie", true, true, undefined, socket.requestIds[1]);
    expect(partials.every((text) => !text.includes("envoie"))).toBe(true);
    expect((await finished).text).toBe("uploaded");
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.size).toBe(44 + 2 * VAD_FRAME * 2);
    transcriber.close();
  });

  it("recovers the whole audio if a later segment is missing rather than sending just the earlier prefix", async () => {
    const { socket, transcriber, speak } = await ears(10);
    speak();
    transcriber.probe();
    socket.transcript("envoie le courriel", true, true, undefined, socket.requestIds[0]);
    transcriber.push(new Float32Array(VAD_FRAME).fill(0.05)); // ... non, ne l'envoie pas
    expect((await transcriber.finishHeard()).text).toBe("uploaded");
    transcriber.close();
  });

  it("never hands a discarded turn's delayed words to a newer identified turn", async () => {
    const { socket, transcriber, speak } = await ears();
    speak();
    transcriber.discard();
    speak();
    const second = transcriber.finishHeard();
    socket.transcript("Julie", true, true, undefined, socket.requestIds[1]);
    socket.transcript("Steve", true, true, undefined, socket.requestIds[0]);
    expect((await second).text).toBe("Julie");
    transcriber.close();
  });

  it("commits audio resumed after a pending probe when discarding, before the next turn starts", async () => {
    const { socket, transcriber, speak } = await ears();
    speak();
    transcriber.probe();
    transcriber.push(new Float32Array(VAD_FRAME).fill(0.05));
    transcriber.discard();
    expect(socket.finalizes).toBe(2);
    speak();
    const next = transcriber.finishHeard();
    socket.transcript("Julie", true, true, undefined, socket.requestIds[2]);
    socket.transcript("discarded tail", true, true, undefined, socket.requestIds[1]);
    socket.transcript("discarded start", true, true, undefined, socket.requestIds[0]);
    expect((await next).text).toBe("Julie");
    transcriber.close();
  });

  it("waits for speech_final: a final chunk after finalize is not the end of the sentence", async () => {
    const { socket, transcriber, speak } = await ears();
    socket.onFinalize = (s) => {
      setTimeout(() => s.transcript("give me a good prompt to", true, false), 2);
      setTimeout(() => s.transcript("write an email to Max", true, true), 6);
    };
    speak();
    const heard = await transcriber.finishHeard();
    expect(heard.text).toBe("give me a good prompt to write an email to Max");
  });

  it("keeps the late words of an utterance the timeout settled out of the next one", async () => {
    const { socket, transcriber, speak } = await ears(30);
    socket.onFinalize = (s) => {
      if (s.finalizes === 1) {
        s.transcript("the weather right now in", true, false);
        // its last chunk comes after the timeout
        setTimeout(() => s.transcript("Trois-Rivieres", true, true), 60);
      } else setTimeout(() => s.transcript("thanks", true, true), 2);
    };
    speak();
    expect((await transcriber.finishHeard()).text).toBe("the weather right now in");
    await wait(80);
    speak();
    expect((await transcriber.finishHeard()).text).toBe("thanks");
  });

  it("an utterance xAI already closed (speech_final) with no audio since needs no finalize", async () => {
    const { socket, transcriber, speak } = await ears();
    speak();
    socket.transcript("what time is it", true, true);
    expect((await transcriber.finishHeard()).text).toBe("what time is it");
    expect(socket.finalizes).toBe(0);
  });

  it("reports xAI's lowest confidence in the utterance", async () => {
    const { socket, transcriber, speak } = await ears();
    socket.onFinalize = (s) => {
      s.transcript("call", true, false, 0.9);
      s.transcript("Max", true, true, 0.3);
    };
    speak();
    expect(await transcriber.finishHeard()).toEqual({ text: "call Max", confidence: 0.3 });
  });
});

describe("Smart Turn", () => {
  it("exposes the end of turn confidence of the partial being notified", async () => {
    const { socket, transcriber, speak } = await ears();
    const seen: Array<[string, number | undefined]> = [];
    transcriber.onPartial((text) => seen.push([text, transcriber.endOfTurnConfidence]));
    speak();
    socket.fire("message", { data: JSON.stringify({ type: "transcript", text: "peux-tu regarder le billet", final: false, speechFinal: false, endOfTurnConfidence: 0.2 }) });
    socket.transcript("peux-tu regarder le billet de CONTOSO", false, false);
    expect(seen).toEqual([["peux-tu regarder le billet", 0.2], ["peux-tu regarder le billet de CONTOSO", undefined]]);
  });
});

describe("a silence probe", () => {
  it("sends one finalize and does not send another with no new audio", async () => {
    const { socket, transcriber, speak } = await ears();
    socket.onFinalize = (s) => setTimeout(() => s.transcript("voiture.", true, true), 5);
    speak();
    expect(transcriber.probe()).toBe(true);
    expect(transcriber.holdingSilence).toBe(true);
    expect(transcriber.probe()).toBe(false);
    expect(socket.finalizes).toBe(1);
    expect((await transcriber.finishHeard()).text).toBe("voiture.");
    expect(socket.finalizes).toBe(1);
    expect(transcriber.forcedFlush).toBe(true);
  });

  it("finishHeard waits on an in-flight probe", async () => {
    const { socket, transcriber, speak } = await ears();
    speak();
    expect(transcriber.probe()).toBe(true);
    const pending = transcriber.finishHeard();
    expect(socket.finalizes).toBe(1);
    socket.transcript("hello bot", true, true);
    await expect(pending).resolves.toEqual({ text: "hello bot" });
    expect(socket.finalizes).toBe(1);
  });

  it("uses the interim when finalize never answers", async () => {
    const { socket, transcriber, speak } = await ears(40);
    speak();
    socket.transcript("quelle heure", false, false);
    const pending = transcriber.finishHeard();
    await wait(60);
    await expect(pending).resolves.toEqual({ text: "quelle heure" });
  });
});

describe("a final chunk xAI sends again", () => {
  it("a chunk already closed and resent after the finalize is kept once (never the sentence twice)", async () => {
    const { socket, transcriber, speak } = await ears();
    const partials: string[] = [];
    transcriber.onPartial((text) => partials.push(text));
    socket.onFinalize = (s) => setTimeout(() => s.transcript("Yeah, but I always thought it.", true, true), 2);
    speak();
    socket.transcript("Yeah, but I always thought it.", true, false);
    expect((await transcriber.finishHeard()).text).toBe("Yeah, but I always thought it.");
    expect(partials.every((text) => text === "Yeah, but I always thought it.")).toBe(true);
  });

  it("the whole utterance resent as one chunk is not appended to itself", async () => {
    const { socket, transcriber, speak } = await ears();
    socket.onFinalize = (s) => setTimeout(() => s.transcript("call Max about the invoice", true, true), 2);
    speak();
    socket.transcript("call Max", true, false);
    socket.transcript("about the invoice", true, false);
    expect((await transcriber.finishHeard()).text).toBe("call Max about the invoice");
  });

  it("the person's own short repeat stays ('no, no')", async () => {
    const { socket, transcriber, speak } = await ears();
    socket.onFinalize = (s) => setTimeout(() => s.transcript("no, no", true, true), 2);
    speak();
    socket.transcript("no, no", true, false);
    expect((await transcriber.finishHeard()).text).toBe("no, no no, no");
  });
});

/** A transcriber whose every connect gets a new socket (a reconnect). */
async function reconnecting(options: { transcribe?: () => Promise<string>; finalTimeoutMs?: number; refuse?: () => boolean } = {}) {
  const sockets: Socket[] = [];
  const transcribe = vi.fn(options.transcribe ?? (async () => "uploaded"));
  const transcriber = new LiveTranscriber({
    botId: "b-1",
    language: () => "en",
    threadId: () => "t-1",
    socket: () => {
      const socket = new Socket(options.refuse?.() ?? false);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    transcribe,
    finalTimeoutMs: options.finalTimeoutMs ?? 300,
    backoffMs: [5, 10, 20],
    reconnectEveryMs: 20,
  });
  expect(await transcriber.connect()).toBe(true);
  const speak = () => {
    transcriber.begin([]);
    transcriber.push(new Float32Array(VAD_FRAME).fill(0.05));
  };
  return { sockets, transcriber, speak, transcribe };
}

/** the socket died (Wi-Fi switch, sleep): close then error, as browsers do */
function drop(socket: Socket) {
  socket.readyState = 3;
  socket.fire("close", {});
  socket.fire("error", {});
}

describe("a dropped listen socket", () => {
  it("an idle drop reconnects: the next turn streams on a new socket, nothing uploaded", async () => {
    const { sockets, transcriber, speak, transcribe } = await reconnecting();
    drop(sockets[0]!);
    expect(transcriber.streaming).toBe(false);
    await wait(30);
    expect(sockets).toHaveLength(2);
    expect(transcriber.streaming).toBe(true);
    sockets[1]!.onFinalize = (s) => setTimeout(() => s.transcript("still there?", true, true), 2);
    speak();
    expect((await transcriber.finishHeard()).text).toBe("still there?");
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("keeps trying after the backoff, every few seconds, and resets once ready", async () => {
    let refuse = false;
    const { sockets, transcriber } = await reconnecting({ refuse: () => refuse });
    refuse = true;
    drop(sockets[0]!);
    // the backoff (3) and more tries every 20 ms after it. #3671: waited on,
    // not counted after a fixed wait: how many 20 ms timers fit in one
    // depends on the host's timer grain (about 16 ms on Windows)
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(5), { timeout: 5_000, interval: 5 });
    refuse = false;
    await vi.waitFor(() => expect(transcriber.streaming).toBe(true), { timeout: 5_000, interval: 5 });
    const count = sockets.length;
    drop(sockets.at(-1)!);
    await wait(8);
    // reset: the first wait of the backoff again (5 ms)
    expect(sockets.length).toBe(count + 1);
    transcriber.close();
  });

  it("a drop mid-utterance: the older finalized one is uploaded once, the current one is resent whole on the new socket", async () => {
    const { sockets, transcriber, speak, transcribe } = await reconnecting();
    speak();
    const older = transcriber.finishHeard();
    expect(sockets[0]!.finalizes).toBe(1);
    // the next utterance starts before xAI answered the first
    speak();
    transcriber.push(new Float32Array(VAD_FRAME).fill(0.05));
    sockets[0]!.transcript("half of the", false, false);
    drop(sockets[0]!);
    await wait(30);
    expect(sockets).toHaveLength(2);
    // every frame of the current utterance went out again, from its first
    const resent = sockets[1]!.audio;
    expect(resent).toBe(2);
    sockets[1]!.onFinalize = (s) => setTimeout(() => s.transcript("second sentence", true, true), 2);
    const current = transcriber.finishHeard();
    await expect(older).resolves.toEqual({ text: "uploaded" });
    await expect(current).resolves.toEqual({ text: "second sentence" });
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("an utterance the timeout settled does not eat the next one's words after a reconnect", async () => {
    const { sockets, transcriber, speak, transcribe } = await reconnecting({ finalTimeoutMs: 20 });
    speak();
    sockets[0]!.transcript("the weather in", false, false);
    // finalize never answered: settled on its interim, its late words drained
    expect((await transcriber.finishHeard()).text).toBe("the weather in");
    speak();
    drop(sockets[0]!);
    await wait(30);
    sockets[1]!.onFinalize = (s) => setTimeout(() => s.transcript("thanks", true, true), 2);
    expect((await transcriber.finishHeard()).text).toBe("thanks");
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("the server's `reconnected` (xAI replaced behind the socket) resends the current utterance", async () => {
    const { sockets, transcriber, speak, transcribe } = await reconnecting();
    speak();
    expect(sockets[0]!.audio).toBe(1);
    sockets[0]!.transcript("lost words", false, false);
    sockets[0]!.fire("message", { data: JSON.stringify({ type: "reconnected" }) });
    expect(sockets[0]!.audio).toBe(2);
    sockets[0]!.onFinalize = (s) => setTimeout(() => s.transcript("fresh words", true, true), 2);
    expect((await transcriber.finishHeard()).text).toBe("fresh words");
    expect(transcribe).not.toHaveBeenCalled();
  });
});

describe("a failed upload", () => {
  it("is tried once more, then reported failed (never a silent empty turn)", async () => {
    const transcribe = vi.fn(async () => { throw new Error("offline"); });
    const transcriber = new LiveTranscriber({
      botId: "b-1", language: () => "en", threadId: () => "t-1",
      socket: () => { throw new Error("no sockets"); },
      transcribe, backoffMs: [], finalTimeoutMs: 50,
    });
    expect(await transcriber.connect()).toBe(false);
    transcriber.begin([new Float32Array(VAD_FRAME).fill(0.05)]);
    expect(await transcriber.finishHeard()).toEqual({ text: "", failed: true });
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it("a second try that works is the turn's words", async () => {
    const transcribe = vi.fn().mockRejectedValueOnce(new Error("blip")).mockResolvedValueOnce("got it");
    const transcriber = new LiveTranscriber({
      botId: "b-1", language: () => "en", threadId: () => "t-1",
      socket: () => { throw new Error("no sockets"); },
      transcribe, backoffMs: [],
    });
    await transcriber.connect();
    transcriber.begin([new Float32Array(VAD_FRAME).fill(0.05)]);
    expect(await transcriber.finishHeard()).toEqual({ text: "got it" });
  });
});

describe("dictation over the stream (composer mic, 2026-10-29)", () => {
  it("shows the words while the person speaks and has them right after the stop, with no upload", async () => {
    const uploads = vi.fn(async () => "uploaded");
    const socket = new Socket();
    const transcriber = new LiveTranscriber({
      botId: "b-1",
      language: () => "auto",
      threadId: () => "t-1",
      socket: () => socket as unknown as WebSocket,
      transcribe: uploads,
      finalTimeoutMs: 1_500,
    });
    const shown: string[] = [];
    transcriber.onPartial((text) => shown.push(text));
    // the frames heard before the socket is ready wait and go out once it is
    const ready = transcriber.connect();
    transcriber.begin([]);
    for (let i = 0; i < 20; i++) transcriber.push(new Float32Array(VAD_FRAME).fill(0.05));
    expect(await ready).toBe(true);
    expect(socket.audio).toBe(20);
    socket.transcript("est-ce que j'ai", false, false);
    socket.transcript("est-ce que j'ai des tâches en cours", false, false);
    expect(shown.at(-1)).toBe("est-ce que j'ai des tâches en cours");
    // a fake xAI answers the finalize 40 ms later
    socket.onFinalize = (s) => setTimeout(() => s.transcript("Est-ce que j'ai des tâches en cours?", true, true), 40);
    const stoppedAt = performance.now();
    const heard = await transcriber.finishHeard();
    const waited = performance.now() - stoppedAt;
    expect(heard.text).toBe("Est-ce que j'ai des tâches en cours?");
    expect(socket.finalizes).toBe(1);
    expect(uploads).not.toHaveBeenCalled();
    // the round trip only: no fixed wait, far under the 2 s target
    expect(waited).toBeLessThan(500);
    transcriber.close();
  });
});
