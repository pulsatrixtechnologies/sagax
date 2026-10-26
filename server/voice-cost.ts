// An estimate of what xAI voice costs, so a speech or transcription request
// counts toward the spend limits (server/spend.ts). xAI reports no price on
// these calls: speech is estimated per character and transcription per second
// of audio (audio size at 16 kHz, 16-bit mono). A known approximation: the
// real bill may differ. Prices are list prices, as of 2026-10.
const TTS_USD_PER_MILLION_CHARACTERS = 4.2;
const STT_USD_PER_HOUR = 0.1;
const STT_BYTES_PER_SECOND = 32_000;

export function voiceCostUsd(model: string, input: number): number | null {
  const amount = Number.isFinite(input) && input > 0 ? input : 0;
  if (model === "grok-tts") return (amount / 1_000_000) * TTS_USD_PER_MILLION_CHARACTERS;
  if (model === "grok-stt") return (amount / STT_BYTES_PER_SECOND / 3600) * STT_USD_PER_HOUR;
  return null;
}
