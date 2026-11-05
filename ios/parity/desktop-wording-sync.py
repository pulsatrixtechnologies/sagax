#!/usr/bin/env python3
"""Write the desktop's words into ios/App/Localizable.xcstrings for every
label of ios/parity/desktop-wording.json (en and fr, and pt-BR when the
desktop has it): `python3 ios/parity/desktop-wording-sync.py`. The check is
src/components/ios-desktop-wording.test.ts."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "ios" / "App" / "Localizable.xcstrings"
mapping = json.loads((ROOT / "ios" / "parity" / "desktop-wording.json").read_text())
locales = {lang: json.loads((ROOT / "src" / "locales" / f"{name}.json").read_text())
           for lang, name in (("en", "en"), ("fr", "fr"), ("pt-BR", "pt-br"))}
doc = json.loads(CATALOG.read_text())
strings = doc["strings"]
changed = 0
for key, desktop_key in mapping.items():
    if key == "//":
        continue
    entry = strings.setdefault(key, {})
    for lang, table in locales.items():
        value = table.get(desktop_key)
        if value is None:
            continue
        value = re.sub(r"\{\w+\}", "%@", value)
        localizations = entry.setdefault("localizations", {})
        if lang == "en" and value == key and "en" not in localizations:
            continue
        if localizations.get(lang, {}).get("stringUnit", {}).get("value") != value:
            localizations[lang] = {"stringUnit": {"state": "translated", "value": value}}
            changed += 1
    if not entry.get("localizations"):
        entry.pop("localizations", None)
doc["strings"] = dict(sorted(strings.items()))
CATALOG.write_text(json.dumps(doc, indent=2, ensure_ascii=False, separators=(",", ": ")) + "\n")
print(f"{changed} values written")
