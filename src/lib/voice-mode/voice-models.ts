// The on-device voice models, loaded on demand: Silero VAD (who is talking
// when) and, when asked, the CAM++ speaker embedding (whose voice). One
// loader for the live call (call.ts) and listening (#4100,
// src/lib/listening/listening-session.ts).
import vadModelUrl from "./models/silero-vad-v5.onnx?url";
import speakerModelUrl from "./models/campplus-sv-en-int8.onnx?url";
import { loadOrt } from "./onnx";
import { SpeakerEmbedder } from "./speaker-id";
import { SileroVad, type VoiceProbability } from "./vad";

export { speakerModelUrl };

export async function loadVoiceModels(withSpeaker: boolean): Promise<{ vad: VoiceProbability; embedder: SpeakerEmbedder | null }> {
  const ort = await loadOrt();
  const [vad, embedder] = await Promise.all([
    SileroVad.load(ort, vadModelUrl),
    withSpeaker ? SpeakerEmbedder.load(ort, speakerModelUrl).catch(() => null) : Promise.resolve(null),
  ]);
  return { vad, embedder };
}
