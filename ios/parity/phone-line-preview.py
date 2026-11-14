#!/usr/bin/env python3
"""Writes App/PhoneLinePreview.json: the store preview chats of #4122, texts
that came in on the person's phone line in the live order (text, answer,
text, answer), drawn as the "Asked by" row (#4112 on the desktop). One bot
per case and language:

    preview-phone-one-<fr|en>    one text and its answer
    preview-phone-three-<fr|en>  three texts from one number, each answered
    preview-phone-two-<fr|en>    texts from two numbers, each answered

Launched with -store-preview -phone-line-preview -previewOpenBot <id>;
-previewOpenIncoming <text id> opens the row on that text's number.
Numbers are 555 numbers only (public repository).

    python3 ios/parity/phone-line-preview.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "App", "PhoneLinePreview.json")

BASE = 1787028000000
MIN = 60_000
FIRST = "+15550100142"
SECOND = "+15550100199"

WORDS = {
    "fr": {
        "typed": "Rappelle-moi de vérifier les sauvegardes ce soir.",
        "typedAnswer": "C'est noté, je te le rappelle à 18 h.",
        "texts": [
            "Est-ce que le serveur est revenu ?",
            "Merci. Et l'imprimante du 2e ?",
            "Parfait, je passe demain matin.",
            "Peux-tu confirmer le rendez-vous de mardi ?",
        ],
        "answers": [
            "Oui, le serveur répond depuis 9 h 12.",
            "L'imprimante est en ligne, un bourrage a été retiré.",
            "Bien reçu, à demain.",
            "Oui, mardi 10 h est confirmé.",
        ],
    },
    "en": {
        "typed": "Remind me to check the backups tonight.",
        "typedAnswer": "Noted, I will remind you at 6 PM.",
        "texts": [
            "Is the server back up?",
            "Thanks. And the second floor printer?",
            "Great, I will come by tomorrow morning.",
            "Can you confirm Tuesday's appointment?",
        ],
        "answers": [
            "Yes, the server has answered since 9:12.",
            "The printer is online, a jam was cleared.",
            "Got it, see you tomorrow.",
            "Yes, Tuesday at 10 is confirmed.",
        ],
    },
}

CASES = {
    "one": [FIRST],
    "three": [FIRST, FIRST, FIRST],
    "two": [FIRST, SECOND, FIRST, SECOND],
}


def chat(case, lang):
    words = WORDS[lang]
    rows = []

    def add(row):
        if rows:
            row["parentId"] = rows[-1]["id"]
        rows.append(row)

    at = BASE
    add({"id": f"{case}-{lang}-u", "role": "user", "kind": "text", "at": at, "text": words["typed"]})
    add({"id": f"{case}-{lang}-ua", "role": "bot", "kind": "text", "at": at + 4000, "text": words["typedAnswer"],
         "turnId": f"{case}-{lang}-turn-u", "turnTerminal": True, "turnSucceeded": True, "requestMessageId": f"{case}-{lang}-u"})
    for index, number in enumerate(CASES[case]):
        at += 7 * MIN
        text_id = f"{case}-{lang}-t{index + 1}"
        add({"id": text_id, "role": "user", "kind": "text", "at": at, "text": words["texts"][index], "via": "sms",
             "sender": {"name": number, "id": "preview-person"}})
        add({"id": f"{case}-{lang}-s{index + 1}", "role": "bot", "kind": "activity", "at": at + 2000,
             "tool": {"name": "Search", "ok": True}, "turnId": f"{case}-{lang}-turn-{index + 1}", "requestMessageId": text_id})
        add({"id": f"{case}-{lang}-r{index + 1}", "role": "bot", "kind": "text", "at": at + 5000, "text": words["answers"][index],
             "turnId": f"{case}-{lang}-turn-{index + 1}", "turnTerminal": True, "turnSucceeded": True, "requestMessageId": text_id})
    return rows


bots = []
for lang in ("fr", "en"):
    for case in CASES:
        messages = chat(case, lang)
        bot_id = f"preview-phone-{case}-{lang}"
        bots.append({
            "id": bot_id, "threadId": f"preview-thread-phone-{case}-{lang}", "name": "Rocket", "title": "Assistant",
            "description": "", "notifications": True, "color": "cyan", "unread": False,
            "modelSelection": {"instanceId": "preview", "model": "preview"}, "createdAt": 1787000000000,
            "activeLeafId": messages[-1]["id"],
            "tasks": [{"threadId": f"preview-thread-phone-{case}-{lang}", "title": "Rocket", "createdAt": 1787000000000}],
            "messages": messages,
        })

with open(OUT, "w", encoding="utf-8") as handle:
    json.dump({"bots": bots, "groups": []}, handle, ensure_ascii=False, indent=1)
    handle.write("\n")
print(OUT)
