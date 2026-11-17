// #4100 lot "listening-speakers": the online assignment of each finished
// utterance to a voice of the session, on real fixture embeddings (the
// CAM++ model the app ships, run with onnxruntime-web like models.test.ts):
// two voices, a returning voice, a short utterance, the person's own voice,
// and the echo drop.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as ort from "onnxruntime-web/wasm";
import { beforeAll, describe, expect, it } from "vitest";

import { SpeakerEmbedder, voiceprintOf } from "@/lib/voice-mode/speaker-id";

import { assignSpeaker, echoOf, newSpeakerBook, speakerLabel } from "./speakers";

const HERE = dirname(fileURLToPath(import.meta.url));
const VOICE = join(HERE, "..", "voice-mode");

function wav(name: string): Float32Array {
  const bytes = readFileSync(join(VOICE, "fixtures", name));
  let offset = 12;
  while (offset < bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === "data") {
      const out = new Float32Array(size / 2);
      for (let i = 0; i < out.length; i++) out[i] = bytes.readInt16LE(offset + 8 + i * 2) / 32768;
      return out;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`no data in ${name}`);
}

const seconds = (samples: Float32Array) => samples.length / 16_000;
const label = (n: number) => `Speaker ${n}`;
const embeddings = new Map<string, { vector: Float32Array; seconds: number }>();

beforeAll(async () => {
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "error";
  const embedder = await SpeakerEmbedder.load(ort as never, new Uint8Array(readFileSync(join(VOICE, "models", "campplus-sv-en-int8.onnx"))));
  for (const name of ["speaker-a-1", "speaker-a-2", "speaker-a-3", "speaker-b-1", "speaker-b-2", "speaker-c-1"]) {
    const samples = wav(`${name}.wav`);
    embeddings.set(name, { vector: (await embedder.embed(samples))!, seconds: seconds(samples) });
  }
}, 60_000);

const heard = (name: string) => embeddings.get(name)!;

describe("telling speakers apart in a listening session (#4100)", () => {
  it("keeps two voices apart and gives a returning voice its first label", () => {
    const book = newSpeakerBook({ personName: "Ada", voiceprint: null, label });
    const order = ["speaker-a-1", "speaker-b-1", "speaker-a-2", "speaker-b-2", "speaker-a-3"];
    const keys = order.map((name) => assignSpeaker(book, "microphone", heard(name).vector, heard(name).seconds));
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[2]).toBe(keys[0]);
    expect(keys[3]).toBe(keys[1]);
    expect(keys[4]).toBe(keys[0]);
    expect(book.speakers.map((speaker) => speaker.label)).toEqual(["Speaker 1", "Speaker 2"]);
  });

  it("puts a short utterance without an embedding under the channel's latest voice", () => {
    const book = newSpeakerBook({ personName: "Ada", voiceprint: null, label });
    const first = assignSpeaker(book, "microphone", heard("speaker-c-1").vector, heard("speaker-c-1").seconds);
    expect(assignSpeaker(book, "microphone", null, 0.3)).toBe(first);
    // the computer's sound is its own channel: a new speaker there
    const other = assignSpeaker(book, "computer", null, 0.3);
    expect(other).not.toBe(first);
    expect(speakerLabel(book, other)).toBe("Speaker 2");
  });

  it("names the person's own voice from their voiceprint", () => {
    const voiceprint = voiceprintOf([heard("speaker-a-1").vector, heard("speaker-a-2").vector], 0.05);
    const book = newSpeakerBook({ personName: "Ada", voiceprint, label });
    const other = assignSpeaker(book, "microphone", heard("speaker-b-1").vector, heard("speaker-b-1").seconds);
    const mine = assignSpeaker(book, "microphone", heard("speaker-a-3").vector, heard("speaker-a-3").seconds);
    expect(speakerLabel(book, mine)).toBe("Ada");
    expect(speakerLabel(book, other)).toBe("Speaker 1");
  });

  it("drops a microphone line that repeats the computer's sound of the same moment", () => {
    const computer = [{ at: 10_000, text: "We will ship the release on Friday." }];
    expect(echoOf({ at: 10_800, text: "we will ship the release on friday" }, computer)).toBe(true);
    expect(echoOf({ at: 30_000, text: "we will ship the release on friday" }, computer)).toBe(false);
    expect(echoOf({ at: 10_500, text: "Sounds good to me." }, computer)).toBe(false);
  });
});
