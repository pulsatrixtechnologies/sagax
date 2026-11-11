#!/usr/bin/env python3
"""Writes App/ChatRelevantPreview.json: the store preview chat of #3581 with
the numbers of a heavy user (17 routines reporting within the same hour, 15
bots asking, 5 requests from three bots, AI client copies, a running turn
folded, a background task running). Launched with -store-preview
-chat-relevant-preview -open-first; ios/parity/capture.sh draws it as the
"cards" (end) and "cards-top" (start) screens with PARITY_EXTRA_ARGS.

    python3 ios/parity/chat-relevant-preview.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "App", "ChatRelevantPreview.json")

BASE = 1787028000000  # one hour of work
MIN = 60_000
messages = []


def add(message):
    message.setdefault("role", "bot")
    if messages:
        message["parentId"] = messages[-1]["id"]
    messages.append(message)
    return message


def text(id, at, words, role="bot", **extra):
    return add({"id": id, "kind": "text", "at": at, "text": words, "role": role, **extra})


COLORS = ["blue", "green", "orange", "pink", "purple", "cyan", "yellow", "red"]
TEAM = [{"id": f"preview-bot-{i}", "name": name, "color": COLORS[i % len(COLORS)]} for i, name in enumerate(
    ["Reviewer", "Tester", "Bot B", "Bot C", "Bot D", "Bot E", "Bot F", "Bot G", "Bot H", "Bot I", "Bot J", "Bot K", "Bot L", "Bot M", "Bot N"])]


def receipt(id, at, bot, words, reply=None):
    add({"id": id, "kind": "activity", "at": at, "from": {"botId": bot["id"], "name": bot["name"], "color": bot["color"]},
         "tool": {"name": f"Asked by {bot['name']}", "ok": True, "input": words, "handoffId": f"h-{id}"},
         "threadRef": {"botId": "preview-server", "threadId": f"w-{id}", "title": "Teammate work"}})
    if reply:
        add({"id": f"{id}-reply", "kind": "activity", "at": at + 20_000, "roomRequest": {"id": f"h-{id}", "phase": "result"},
             "from": {"botId": "preview-server", "name": "Server", "color": "cyan"},
             "tool": {"name": "Server replied", "ok": True, "output": reply},
             "threadRef": {"botId": "preview-server", "threadId": f"w-{id}", "title": "Teammate work"}})


# A turn: two notes and two steps fold behind "Worked", the answer stays.
text("u1", BASE, "Check the board and tell me what is left for today.", role="user")
text("n1", BASE + 5_000, "Reading the board first.", turnId="t1")
add({"id": "s1", "kind": "activity", "at": BASE + 8_000, "turnId": "t1", "tool": {"name": "Read", "ok": True, "input": "{\"file_path\":\"board.md\"}", "durationMs": 900}})
text("n2", BASE + 30_000, "Now the open tickets.", turnId="t1")
add({"id": "s2", "kind": "activity", "at": BASE + 40_000, "turnId": "t1", "tool": {"name": "Grep", "ok": True, "input": "{\"pattern\":\"open\"}", "durationMs": 400}})
text("a1", BASE + 173_000, "Three tickets are left for today: two wait on a part and one needs your signature on the quote.", turnId="t1", turnTerminal=True)

# Five requests from three bots at once: one line with a count.
for index, bot in enumerate([TEAM[0], TEAM[1], TEAM[0], TEAM[2], TEAM[1]]):
    receipt(f"r{index}", BASE + 4 * MIN + index * 5_000, bot,
            f"Please check pull request {3550 + index} and tell me if the tests pass.",
            reply=f"PASS. The tests of pull request {3550 + index} pass and the build is green.")

text("a2", BASE + 6 * MIN, "I answered the five reviews; all of them pass.")

# Fifteen bots asking in one burst: three names, then "and 12 others".
for index, bot in enumerate(TEAM):
    receipt(f"q{index}", BASE + 7 * MIN + index * 2_000, bot, f"Can you share the status of task {index + 1}?")

text("a3", BASE + 9 * MIN, "Shared the status with the whole team.")

# Copies of an AI client's exchanges stored in the chat: the names line.
for index in range(3):
    add({"id": f"m{index}", "kind": "text", "at": BASE + 10 * MIN + index * 4_000, "relayVia": "mcp", "relayOf": f"x{index}",
         "relayAsk": {"text": f"Summarize ticket {4790 + index}", "by": "AI client"},
         "text": f"Ticket {4790 + index} waits on the client; the follow-up note went out this morning."})

# A background task running: the step row with its Stop.
add({"id": "p1", "kind": "activity", "at": BASE + 11 * MIN,
     "parallelTask": {"threadId": "preview-parallel", "title": "Draft the renewal email", "requestMessageId": "u2",
                      "role": "card", "state": "running", "startedAt": BASE + 11 * MIN}})
# Two background tasks that ended badly: each keeps its row, in the danger
# ink, with what happened and the way into the task.
add({"id": "p2", "kind": "activity", "at": BASE + 11 * MIN + 10_000,
     "parallelTask": {"threadId": "preview-parallel-failed", "title": "Check the supplier price list", "requestMessageId": "u2",
                      "role": "card", "state": "failed", "startedAt": BASE + 11 * MIN, "endedAt": BASE + 11 * MIN + 95_000}})
add({"id": "p3", "kind": "activity", "at": BASE + 11 * MIN + 20_000,
     "parallelTask": {"threadId": "preview-parallel-stopped", "title": "Sort last week's tickets", "requestMessageId": "u2",
                      "role": "card", "state": "stopped", "startedAt": BASE + 11 * MIN, "endedAt": BASE + 11 * MIN + 42_000}})

# Seventeen routines reporting within the same hour.
text("u2", BASE + 12 * MIN, "And the routines?", role="user")
NAMES = ["Morning dispatch", "Backup check", "New mail triage", "Invoice watch", "Certificate watch", "Calendar sweep",
         "Ticket follow-up", "Agreement banks", "Quote reminders", "Disk space watch", "License renewals", "Antivirus alerts",
         "Patch report", "Supplier orders", "Time entries", "Contract renewals", "Month-end export"]
BRIEFS = ["3 tickets assigned, 1 waits for a part. Nothing else needs you today.",
          "All 12 backups completed; the largest took 41 minutes.",
          "The mailbox refused the sign-in, so 4 messages were not sorted. Sign in again from Connect apps.",
          "Two invoices are still unpaid after 30 days; I sent the reminder on both.",
          "The 4 certificates are renewed until 2027.",
          "Nothing moved on tomorrow's calendar.",
          "I followed up on 5 tickets that waited on a client answer.",
          "One agreement is over its bank by 2.5 hours.",
          "Two quotes wait for a signature since Monday.",
          "Every disk has more than 20 percent free.",
          "Three licenses renew next month; the list is in the report.",
          "No new alert since yesterday.",
          "41 machines are patched, 2 wait for a restart.",
          "The parts order shipped and arrives Friday.",
          "12 time entries were added for yesterday.",
          "One contract renews in 30 days.",
          ""]
for index, name in enumerate(NAMES):
    at = BASE + 13 * MIN + index * 2 * MIN
    run = {"runId": f"run{index}", "routineId": f"routine{index}", "routineName": name, "status": "completed",
           "summary": "Here is this pass.\n\n| Item | State |\n|---|---|\n| one | done |\n\n" + BRIEFS[index]}
    if index == 2:
        run["problems"] = "the mailbox refused the sign-in"
        run["repeat"] = {"firstRunId": "run0", "count": 4, "since": BASE - 18 * 60 * MIN, "lastAt": at}
    if index == len(NAMES) - 1:
        run = {"runId": f"run{index}", "routineId": f"routine{index}", "routineName": name, "status": "running",
               "startedAt": at, "startedBy": "person"}
    if index == len(NAMES) - 2:
        run["brief"] = BRIEFS[index]
    add({"id": f"rr{index}", "kind": "routine.run", "at": at, "text": f"Routine “{name}” completed", "routineRun": run})

server = {
    "id": "preview-server", "threadId": "preview-thread-server", "name": "Server", "title": "Operations",
    "description": "Keeps the board moving.", "notifications": True, "color": "cyan", "section": "Launch",
    "chiefOfStaff": True, "unread": False, "modelSelection": {"instanceId": "preview", "model": "preview"},
    "createdAt": BASE - 1_000_000, "activeLeafId": messages[-1]["id"], "pinned": True,
    "tasks": [{"threadId": "preview-thread-server", "title": "Operations", "createdAt": BASE - 1_000_000},
              {"threadId": "preview-parallel", "title": "Draft the renewal email", "createdAt": BASE + 11 * MIN, "busy": True,
               "parallelOf": {"threadId": "preview-thread-server", "messageId": "u2", "at": BASE + 11 * MIN}}],
    "messages": messages,
}
team = [{"id": bot["id"], "threadId": f"{bot['id']}-thread", "name": bot["name"], "title": "Teammate", "description": "",
         "notifications": True, "color": bot["color"], "unread": False,
         "modelSelection": {"instanceId": "preview", "model": "preview"}, "createdAt": BASE - 1_000_000,
         "tasks": [{"threadId": f"{bot['id']}-thread", "title": "Work", "createdAt": BASE - 1_000_000}], "messages": []}
        for bot in TEAM]
with open(OUT, "w") as handle:
    json.dump({"bots": [server] + team, "groups": []}, handle, indent=2, ensure_ascii=False)
    handle.write("\n")
print(OUT, len(messages), "messages")
