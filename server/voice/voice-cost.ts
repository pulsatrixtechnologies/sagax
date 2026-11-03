// An estimate of what voice costs (xAI, OpenAI, ElevenLabs), so a speech or transcription request
// counts toward the spend limits (server/usage/spend.ts). xAI reports no price on
// these calls: speech is estimated per character and transcription per second
// of audio (audio size at 16 kHz, 16-bit mono). A known approximation: the
// real bill may differ. Prices are list prices, as of 2026-10.
const TTS_USD_PER_MILLION_CHARACTERS = 4.2;
const STT_USD_PER_HOUR = 0.1;
const STT_BYTES_PER_SECOND = 32_000;
// 2026-10-29, list prices: OpenAI gpt-4o-mini-tts about $0.015 a minute of
// speech (some 900 characters), its transcription about $0.006 a minute;
// ElevenLabs Flash about $0.05 per 1,000 characters on a paid plan.
const OPENAI_TTS_USD_PER_MILLION_CHARACTERS = 16.7;
const OPENAI_STT_USD_PER_HOUR = 0.36;
const ELEVENLABS_TTS_USD_PER_MILLION_CHARACTERS = 50;

// xAI's Voice Agent API: about $0.05 a minute of connected call (list
// price, 2026-10); `input` is seconds of audio in and out.
const REALTIME_USD_PER_MINUTE = 0.05;

export function voiceCostUsd(model: string, input: number): number | null {
  const amount = Number.isFinite(input) && input > 0 ? input : 0;
  if (model === "grok-realtime") return (amount / 60) * REALTIME_USD_PER_MINUTE;
  if (model === "grok-tts") return (amount / 1_000_000) * TTS_USD_PER_MILLION_CHARACTERS;
  if (model === "grok-stt") return (amount / STT_BYTES_PER_SECOND / 3600) * STT_USD_PER_HOUR;
  if (model === "openai-tts") return (amount / 1_000_000) * OPENAI_TTS_USD_PER_MILLION_CHARACTERS;
  if (model === "openai-stt") return (amount / STT_BYTES_PER_SECOND / 3600) * OPENAI_STT_USD_PER_HOUR;
  if (model === "elevenlabs-tts") return (amount / 1_000_000) * ELEVENLABS_TTS_USD_PER_MILLION_CHARACTERS;
  return null;
}
