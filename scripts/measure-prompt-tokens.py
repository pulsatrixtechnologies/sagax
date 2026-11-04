"""Compare neutral prompt-builder captures, not provider usage or billing.

Requires tiktoken (verification environment only). Usage:
  python scripts/measure-prompt-tokens.py before.json after.json output.json
"""
import hashlib
import json
import sys
from pathlib import Path

import tiktoken


encoding = tiktoken.get_encoding("o200k_base")


def tokens(text):
    return len(encoding.encode(text, disallowed_special=()))


def sections(row):
    if "sectionTexts" in row:
        return row["sectionTexts"]
    # The original 08d438abb capture predates section-text exports. Rebuild
    # them losslessly from its byte lengths and its original split contract.
    volatile_ids = {"memory", "docs", "mentions", "outstanding", "recent", "voice-call",
                    "availability", "model", "stream", "workplace", "reach", "goal", "files-cwd"}
    if row["engine"] == "claudeAgent":
        volatile_ids.update({"plan", "routine-execution", "skill-instructions", "playbooks"})
    stable = row["stable"].encode()
    volatile = row["text"].encode()[len(stable):]
    buffers = {False: stable, True: volatile}
    offsets = {False: 0, True: 0}
    out = []
    for section in row["sections"]:
        is_volatile = section["id"] in volatile_ids
        start = offsets[is_volatile]
        end = start + section["bytes"]
        out.append({"id": section["id"], "text": buffers[is_volatile][start:end].decode()})
        offsets[is_volatile] = end
    assert offsets == {False: len(stable), True: len(volatile)}
    return out


def measure(row, captures):
    parts = sections(row)
    assert sum(len(part["text"].encode()) for part in parts) == row["bytes"]
    assert len(row["text"].encode()) == row["bytes"]
    skills_text = row.get("skillsText")
    if skills_text is None:
        # Automation's old uncapped index was the file-engine index, before
        # the separate cold section budget replaced it with a lazy note.
        source = next(r for r in captures if r["kind"] == "chat" and r["engine"] == ("codex" if row["kind"] == "routine" else row["engine"]))
        skills_text = next(p["text"] for p in sections(source) if p["id"] == "skills")
    assert len(skills_text.encode()) == row["skillsBytes"]
    delivered_skills = next(part["text"] for part in parts if part["id"] == "skills")
    fixed = row["text"].replace(delivered_skills, "", 1)
    return {
        "bytes": row["bytes"], "tokens": tokens(row["text"]),
        "stableBytes": row["stableBytes"], "stableTokens": tokens(row["stable"]),
        "volatileBytes": row["volatileBytes"],
        "volatileTokens": tokens(row["text"][len(row["stable"]):]),
        "stableSha256": hashlib.sha256(row["stable"].encode()).hexdigest(),
        "stableAcrossTurnData": row.get("stableAcrossTurnData", "Current surface:" not in row["stable"]),
        "sections": [{"id": part["id"], "bytes": len(part["text"].encode()), "tokens": tokens(part["text"]),
                      "sha256": hashlib.sha256(part["text"].encode()).hexdigest()} for part in parts],
        "uncappedSkillsIndexBytes": row["skillsBytes"],
        "uncappedSkillsIndexTokens": tokens(skills_text),
        "fixedInstructionBytes": len(fixed.encode()), "fixedInstructionTokens": tokens(fixed),
    }


before, after = (json.loads(Path(name).read_text()) for name in sys.argv[1:3])
assert [(r["engine"], r["kind"]) for r in before] == [(r["engine"], r["kind"]) for r in after]
rows = []
for old, new in zip(before, after):
    b, a = measure(old, before), measure(new, after)
    assert a["bytes"] <= b["bytes"] * 0.6
    assert a["tokens"] <= b["tokens"] * 0.6
    assert a["fixedInstructionBytes"] <= b["fixedInstructionBytes"] * 0.6
    assert a["fixedInstructionTokens"] <= b["fixedInstructionTokens"] * 0.6
    assert a["uncappedSkillsIndexBytes"] <= b["uncappedSkillsIndexBytes"] * 0.6
    assert a["uncappedSkillsIndexTokens"] <= b["uncappedSkillsIndexTokens"] * 0.6
    assert a["stableAcrossTurnData"]
    old_sections = {part["id"]: part for part in b["sections"]}
    for part in a["sections"]:
        if part["id"] in {"misuse-policy", "persona", "soul", "approval-level", "assignment"}:
            assert part["sha256"] == old_sections[part["id"]]["sha256"]
    rows.append({"engine": old["engine"], "kind": old["kind"], "before": b, "after": a,
                 "byteReductionPercent": round(100 * (1 - a["bytes"] / b["bytes"]), 2),
                 "tokenReductionPercent": round(100 * (1 - a["tokens"] / b["tokens"]), 2)})

Path(sys.argv[3]).write_text(json.dumps({
    "issue": 1997, "baselineCommit": "08d438abb", "tokenizer": f"tiktoken {tiktoken.__version__}, o200k_base",
    "scope": "Deterministic representative builder fixtures; Sagax instructions only. Not provider-native token counts or observed cache hits. Native engine prompts, native plugin discovery, tool schemas, history, memory volume and later reference reads are excluded.",
    "cases": rows,
}, indent=2) + "\n")
print(f"{len(rows)} cases: minimum reduction {min(r['byteReductionPercent'] for r in rows)}% bytes, "
      f"{min(r['tokenReductionPercent'] for r in rows)}% comparison tokens")
