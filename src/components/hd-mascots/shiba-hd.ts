// Shiba's HD art (src/assets/mascots/shiba): six looping clips as animated
// WebP with alpha and seventeen stills as WebP with alpha, all 256 px square
// with the dog framed the same way (seated feet on one baseline), so a change
// of state never makes it jump. The walk is one repeating stride; the sad clip
// plays once and rests lying down (scripts/mascots/build-hd-mascot.py). The
// imports are URLs only: a file loads when HdMascot first draws it.
import loopIdle from "@/assets/mascots/shiba/loop-idle.webp";
import loopWalk from "@/assets/mascots/shiba/loop-walk.webp";
import loopJump from "@/assets/mascots/shiba/loop-jump.webp";
import loopTurn from "@/assets/mascots/shiba/loop-turn.webp";
import loopHappy from "@/assets/mascots/shiba/loop-happy.webp";
import loopSad from "@/assets/mascots/shiba/loop-sad.webp";
import stillNeutral from "@/assets/mascots/shiba/still-neutral.webp";
import stillHappy from "@/assets/mascots/shiba/still-happy.webp";
import stillLaughing from "@/assets/mascots/shiba/still-laughing.webp";
import stillSad from "@/assets/mascots/shiba/still-sad.webp";
import stillAngry from "@/assets/mascots/shiba/still-angry.webp";
import stillSurprised from "@/assets/mascots/shiba/still-surprised.webp";
import stillThinking from "@/assets/mascots/shiba/still-thinking.webp";
import stillSleepy from "@/assets/mascots/shiba/still-sleepy.webp";
import stillLove from "@/assets/mascots/shiba/still-love.webp";
import stillConfused from "@/assets/mascots/shiba/still-confused.webp";
import stillWalk from "@/assets/mascots/shiba/still-walk.webp";
import stillJump from "@/assets/mascots/shiba/still-jump.webp";
import stillSit from "@/assets/mascots/shiba/still-sit.webp";
import stillWave from "@/assets/mascots/shiba/still-wave.webp";
import stillFront from "@/assets/mascots/shiba/still-front.webp";
import stillLookLeft from "@/assets/mascots/shiba/still-look-left.webp";
import stillLookRight from "@/assets/mascots/shiba/still-look-right.webp";
import type { HdManifest } from "./hd-types";

export const SHIBA_HD: HdManifest = Object.freeze({
  character: "shiba",
  px: 256,
  loops: Object.freeze({ idle: loopIdle, walk: loopWalk, jump: loopJump, turn: loopTurn, happy: loopHappy, sad: loopSad }),
  stills: Object.freeze({
    neutral: stillNeutral,
    happy: stillHappy,
    laughing: stillLaughing,
    sad: stillSad,
    angry: stillAngry,
    surprised: stillSurprised,
    thinking: stillThinking,
    sleepy: stillSleepy,
    love: stillLove,
    confused: stillConfused,
    walk: stillWalk,
    jump: stillJump,
    sit: stillSit,
    wave: stillWave,
    front: stillFront,
    lookLeft: stillLookLeft,
    lookRight: stillLookRight,
  }),
  loopStill: Object.freeze({ idle: "neutral", walk: "walk", jump: "jump", turn: "lookLeft", happy: "happy", sad: "sad" }),
}) as HdManifest;
