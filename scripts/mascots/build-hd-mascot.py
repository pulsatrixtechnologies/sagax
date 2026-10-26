#!/usr/bin/env python3
"""Build a character's HD mascot assets (src/assets/mascots/<character>/).

Input: an art pack folder holding
  states/<character>-{emotion,pose,view}-*-transparent.png  (stills with alpha)
  clips/<character>-<clip>.mp4                                (loops, opaque)

Output, all square at --size px with the character framed the same way (the
seated pose's height and feet line), so a change of state never makes it jump:
  loop-<id>.webp   animated WebP with alpha, looping
  still-<id>.webp  WebP with alpha

The clips are rendered on a plain backdrop with no alpha channel, so each
frame is matted with rembg (one model session for the whole run); a matte is
soft at the fur's edge, which a chroma key on the grey backdrop and its
shadow could not give. Every frame of a clip shares one transform (the first
frame's), so a jump still rises and a walk still moves.

Needs ffmpeg on PATH and a Python with rembg and Pillow:
  python -I scripts/mascots/build-hd-mascot.py --pack <pack>/shiba --character shiba --out src/assets/mascots/shiba
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

# loop id -> (clip file stem, frames per second kept, how it repeats)
# "whole": the clip returns to its first pose, so it loops as it is.
# "cycle": the clip starts seated then walks; only its best repeating stride
#          is kept (the pair of frames that look most alike, CYCLE_MIN apart).
# "once":  the clip ends somewhere else (the sad dog lies down): it plays once
#          and rests on its last frame.
LOOPS = {
    "idle": ("idle", 12, "whole"),
    "walk": ("walk", 24, "cycle"),
    "jump": ("jump", 24, "whole"),
    "turn": ("turnaround", 24, "whole"),
    "happy": ("happy", 24, "whole"),
    "sad": ("sad", 12, "once"),
}

# a stride is searched in the clip's second half, at least this many frames long
CYCLE_MIN = 12

# still id -> source stem (under states/, "<character>-<stem>-transparent.png")
STILLS = {
    "neutral": "emotion-neutral",
    "happy": "emotion-happy",
    "laughing": "emotion-laughing",
    "sad": "emotion-sad",
    "angry": "emotion-angry",
    "surprised": "emotion-surprised",
    "thinking": "emotion-thinking",
    "sleepy": "emotion-sleepy",
    "love": "emotion-love",
    "confused": "emotion-confused",
    "walk": "pose-walk",
    "jump": "pose-jump",
    "sit": "pose-sit",
    "wave": "pose-wave",
    "front": "view-front",
    "look-left": "view-three-quarter-left",
    "look-right": "view-three-quarter-right",
}

# the seated character's height and feet line, as shares of the output size
HEIGHT_SHARE = 0.824
FEET_SHARE = 0.98


def solid_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    box = image.getchannel("A").point(lambda v: 255 if v > 16 else 0).getbbox()
    if box is None:
        raise SystemExit("a frame came out empty after matting")
    return box


def placement(reference: Image.Image, size: int) -> tuple[float, float, float]:
    """Scale and offset that put the reference's character at the shared height and feet line, centred."""
    left, top, right, bottom = solid_bbox(reference)
    scale = size * HEIGHT_SHARE / (bottom - top)
    dx = size / 2 - (left + right) / 2 * scale
    dy = size * FEET_SHARE - bottom * scale
    return scale, dx, dy


def place(image: Image.Image, size: int, transform: tuple[float, float, float]) -> Image.Image:
    scale, dx, dy = transform
    width, height = round(image.width * scale), round(image.height * scale)
    scaled = image.resize((width, height), Image.LANCZOS)
    x, y = round(dx), round(dy)
    # what falls off the canvas's top or left is cropped first (alpha_composite takes no negative offset)
    scaled = scaled.crop((max(0, -x), max(0, -y), width, height))
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(scaled.crop((0, 0, min(scaled.width, size - max(0, x)), min(scaled.height, size - max(0, y)))), (max(0, x), max(0, y)))
    return canvas


def build_stills(pack: Path, character: str, out: Path, size: int, quality: int) -> None:
    sources = {sid: Image.open(pack / "states" / f"{character}-{stem}-transparent.png").convert("RGBA") for sid, stem in STILLS.items()}
    # one transform for every still: the pack renders them with one camera and one feet line
    transform = placement(sources["neutral"], size)
    for sid, image in sources.items():
        place(image, size, transform).save(out / f"still-{sid}.webp", "WEBP", quality=quality, method=6, alpha_quality=90)


def best_cycle(frames: list[Image.Image]) -> tuple[int, int]:
    """The [start, end) of the most seamless stride in the clip's second half."""
    small = [frame.resize((48, 48)).tobytes() for frame in frames]

    def distance(a: int, b: int) -> int:
        return sum(abs(x - y) for x, y in zip(small[a], small[b]))

    half = len(frames) // 2
    best = None
    for start in range(half, len(frames) - CYCLE_MIN):
        for end in range(start + CYCLE_MIN, len(frames)):
            score = distance(start, end)
            if best is None or score < best[0]:
                best = (score, start, end)
    if best is None:
        return 0, len(frames)
    return best[1], best[2]


def build_loops(pack: Path, character: str, out: Path, size: int, quality: int, only: set[str] | None = None) -> None:
    from rembg import new_session, remove

    session = new_session("u2net")
    for lid, (stem, fps, repeat) in LOOPS.items():
        if only and lid not in only:
            continue
        clip = pack / "clips" / f"{character}-{stem}.mp4"
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(["ffmpeg", "-v", "error", "-i", str(clip), "-vf", f"fps={fps}", str(Path(tmp) / "f%04d.png")], check=True)
            frames = [remove(Image.open(path).convert("RGB"), session=session).convert("RGBA") for path in sorted(Path(tmp).glob("f*.png"))]
        transform = placement(frames[0], size)
        placed = [place(frame, size, transform) for frame in frames]
        if repeat == "cycle":
            start, end = best_cycle(placed)
            placed = placed[start:end]
        placed[0].save(
            out / f"loop-{lid}.webp",
            "WEBP",
            save_all=True,
            append_images=placed[1:],
            duration=round(1000 / fps),
            # 0 repeats forever; 1 plays once and rests on the last frame
            loop=1 if repeat == "once" else 0,
            quality=quality,
            method=6,
            alpha_quality=85,
            minimize_size=True,
        )
        print(f"loop-{lid}.webp: {len(placed)} frames", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pack", type=Path, required=True)
    parser.add_argument("--character", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--size", type=int, default=256)
    parser.add_argument("--quality", type=int, default=72)
    parser.add_argument("--only", choices=["stills", "loops"], default=None)
    parser.add_argument("--loops", default=None, help="comma-separated loop ids to rebuild (default: all)")
    args = parser.parse_args()
    if shutil.which("ffmpeg") is None and args.only != "stills":
        raise SystemExit("ffmpeg is needed for the loops")
    args.out.mkdir(parents=True, exist_ok=True)
    if args.only != "loops":
        build_stills(args.pack, args.character, args.out, args.size, args.quality)
    if args.only != "stills":
        only = set(args.loops.split(",")) if args.loops else None
        build_loops(args.pack, args.character, args.out, args.size, args.quality, only)
    total = sum(path.stat().st_size for path in args.out.glob("*.webp"))
    print(f"{args.out}: {total / 1024 / 1024:.2f} MB", file=sys.stderr)


if __name__ == "__main__":
    main()
