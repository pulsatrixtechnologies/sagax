# Qualification corpus v1

Generated from `scripts/qualification/corpus.ts` by `--emit-corpus`. Do not edit by hand.

Every prompt is synthetic. A task is one row; the manual column is what to do in Grok Bot.

| Id | Category | Task | What must happen | Manual steps (Grok Bot) |
|---|---|---|---|---|
| reply-01 | reply | Short English question | One reply, streamed, no second reply. | Send the prompt in a new conversation. Start the stopwatch on Send; note first visible text and the end of the reply. |
| reply-02 | reply | Short French question with accents | One reply, accents intact. | Same as reply-01 with this French prompt. |
| reply-03 | reply | Long prompt (about 20 KB) | One reply, the whole prompt accepted. | Paste the filler sentence 260 times, then send. |
| reply-04 | reply | Emoji, right to left and CJK text | One reply, no mangled characters. | Send the text as is. |
| reply-05 | reply | Turn with three tool calls | Three tool rows, one final reply. | Ask for a task that uses three tools (list files three times). Count tool rows and replies. |
| reply-06 | reply | Two turns in one conversation | Each question answered once, in order. | Send the first, wait for the end, send the second. Stopwatch the second. |
| busy-01 | busy | One message sent while the bot works | Both messages are answered (folded into the turn or queued), none lost, none answered twice. | Send a message that takes about 30 seconds, then a second one 5 seconds later. |
| busy-02 | busy | Three messages sent while the bot works | All four messages answered once. | As busy-01 with three follow-ups, 3 seconds apart. |
| busy-03 | busy | Bot-routed busy send | The second message is routed by the bot, answered once. | No equivalent. Record skipped with the reason. |
| busy-04 | busy | Second conversation while the first works | The second conversation answers without waiting for the first. | Open a second conversation with the same bot while the first is busy and send there. |
| delegation-01 | delegation | Chief hands work to one teammate | The teammate answers once, the chief reports once, every assignment ends in a terminal state. | Ask the primary bot to have one teammate do a small task and report back. |
| delegation-02 | delegation | Chief hands work to two teammates | Both answer once, the chief reports once with both results. | As delegation-01 with two teammates. |
| delegation-03 | delegation | Chief, lead and specialist chain | Work passes down and the results come back up, once each. | Ask the primary bot to delegate to a lead who delegates to a specialist. |
| routine-01 | routine | Routine run now | One run, completed, its result in the results thread. | Create a routine with a short prompt and press Run now. |
| routine-02 | routine | Routine run twice in a row | Two distinct runs, each completed once. | Press Run now twice, waiting for the first to finish. |
| routine-03 | routine | Scheduled one-time routine | Runs once at its time, without a click. | Schedule a one-time routine 2 minutes ahead; note the start delay. |
| files-01 | files | Chunked upload and download | The committed file downloads byte for byte. | Attach a 3 MB synthetic file, send, then download it from the conversation. |
| files-02 | files | Upload resumed with a replayed chunk and commit | Offsets are honoured, replays are harmless, bytes are exact. | No equivalent. Record skipped with the reason. |
| files-03 | files | File attached to a message and answered | The bot reply arrives once and the file is listed in the thread. | Attach a small file and ask a question about it. |
| pages-01 | pages | Bot proposes a page | A draft page with version 1 exists, once. | Ask the bot to create a one-page HTML report. |
| pages-02 | pages | Page proposed then published by the person | The page publishes with a link, once. | As pages-01, then publish it. |
| failover-01 | failover | Primary engine at its usage limit | The request continues on the backup engine: one user message, one reply, no error text. | Needs an account at its limit; record n/a unless you can reach one safely. |
| failover-02 | failover | Limit reset returns to the primary | After the reset the next turn runs on the primary again. | No equivalent. Record skipped with the reason. |
| cancel-01 | cancel | Stop during a tool call | The bot stops, is idle within seconds, and shows no final reply for the stopped turn. | Start a long task, press Stop while a tool runs. |
| cancel-02 | cancel | Stop then send again | The next message is answered once. | After Stop, send a new message and check one reply. |
| cancel-03 | cancel | Stop with a message queued behind the turn | The bot ends idle and nothing runs by surprise afterwards. | Send two messages quickly, then Stop. |
| reconnect-01 | reconnect | Event stream dropped mid-turn, resumed with its cursor | The client sees the final reply, by replay or by reloading the thread, with no duplicate. | Start a long turn, turn Wi-Fi off for 10 seconds, then on. Check the reply appears once. |
| reconnect-02 | reconnect | Reconnect with an unknown cursor | The server says it could not replay (resumed false) and the thread reload is complete. | No equivalent. Record skipped with the reason. |
| restart-01 | restart | Graceful server restart during a tool call | No stuck state: the accepted message is answered or the thread says it was interrupted. | Restart the Grok Bot service while a tool runs, if you can. |
| restart-02 | restart | Crash (SIGKILL) during a tool call | Same, after an unclean stop. | Kill the Grok Bot process while a tool runs, if you can. |
| restart-03 | restart | Crash with a message queued behind the turn | The queued message is neither lost nor run twice. | No equivalent. Record skipped with the reason. |
| restart-04 | restart | Graceful restart with a message queued behind the turn | The turn resumes once and the queued message is answered or run, not dropped. | No equivalent. Record skipped with the reason. |
| concurrent-01 | concurrent | Six bots messaged at the same moment | Six replies, one each. | Message six bots within two seconds. |
| concurrent-02 | concurrent | Eight rapid sends to one conversation | Every message answered once. | Send eight short messages, one per second, to one bot. |
| concurrent-03 | concurrent | Three bots, three sends each | Nine messages answered once each, no cross-talk between bots. | Three bots, three messages each, interleaved. |
