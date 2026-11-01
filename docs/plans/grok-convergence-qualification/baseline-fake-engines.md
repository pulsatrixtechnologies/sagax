# Qualification report: fake claude CLI (repository fixture)

Corpus v1, engine kind `fake`, revision `71ebdcdb9`, node v26.11.1.
Started 2026-11-01T17:23:36.354Z, finished 2026-11-01T17:26:52.062Z.

## Summary

| Metric | Value |
|---|---|
| Tasks run (skipped) | 35 (0) |
| Completion rate | 100.0% (35/35) |
| Lost accepted messages | 0 |
| Duplicate replies | 0 |
| Duplicate dispatches | 0 |
| Restart recovery | 100.0% (4/4) |
| Stuck states | 0 |
| Time to first token p50 / p95 | 495 ms / 920 ms (n=19 samples) |
| Time to final reply p50 / p95 | 782 ms / 2847 ms (n=19 samples) |

Latency counts only tasks without a deliberate hold (gate, wait for a restart).

## By category

| Category | Run | Completed | First token p50 / p95 | Final p50 / p95 |
|---|---|---|---|---|
| busy | 4 | 4 | n/a / n/a | n/a / n/a |
| cancel | 3 | 3 | n/a / n/a | n/a / n/a |
| concurrent | 3 | 3 | 629 ms / 920 ms | 629 ms / 920 ms |
| delegation | 3 | 3 | 605 ms / 610 ms | 1774 ms / 2847 ms |
| failover | 2 | 2 | n/a / n/a | n/a / n/a |
| files | 3 | 3 | 316 ms / 316 ms | 316 ms / 316 ms |
| pages | 2 | 2 | n/a / n/a | n/a / n/a |
| reconnect | 2 | 2 | n/a / n/a | n/a / n/a |
| reply | 6 | 6 | 342 ms / 495 ms | 827 ms / 1375 ms |
| restart | 4 | 4 | n/a / n/a | n/a / n/a |
| routine | 3 | 3 | 461 ms / 554 ms | 554 ms / 782 ms |

## Tasks

| Id | Category | Status | Lost | Dup reply | Dup dispatch | Restart | First token | Final | Notes |
|---|---|---|---|---|---|---|---|---|---|
| reply-01 | reply | completed | 0 | 0 | 0 | n/a | 354 ms | 354 ms |  |
| reply-02 | reply | completed | 0 | 0 | 0 | n/a | 342 ms | 1162 ms |  |
| reply-03 | reply | completed | 0 | 0 | 0 | n/a | 495 ms | 1375 ms |  |
| reply-04 | reply | completed | 0 | 0 | 0 | n/a | 304 ms | 1137 ms |  |
| reply-05 | reply | completed | 0 | 0 | 0 | n/a | 334 ms | 334 ms |  |
| reply-06 | reply | completed | 0 | 0 | 0 | n/a | 354 ms | 827 ms |  |
| busy-01 | busy | completed | 0 | 0 | 0 | n/a | n/a | n/a |  |
| busy-02 | busy | completed | 0 | 0 | 0 | n/a | n/a | n/a |  |
| busy-03 | busy | completed | 0 | 0 | 0 | n/a | n/a | n/a |  |
| busy-04 | busy | completed | 0 | 0 | 0 | n/a | n/a | n/a |  |
| delegation-01 | delegation | completed | 0 | 0 | 0 | n/a | 610 ms | 1774 ms |  |
| delegation-02 | delegation | completed | 0 | 0 | 0 | n/a | 558 ms | 1707 ms |  |
| delegation-03 | delegation | completed | 0 | 0 | 0 | n/a | 605 ms | 2847 ms |  |
| routine-01 | routine | completed | 0 | 0 | 0 | n/a | 554 ms | 554 ms |  |
| routine-02 | routine | completed | 0 | 0 | 0 | n/a | 461 ms | 782 ms |  |
| routine-03 | routine | completed | 0 | 0 | 0 | n/a | n/a | n/a |  |
| files-01 | files | completed | 0 | 0 | 0 | n/a | n/a | n/a |  |
| files-02 | files | completed | 0 | 0 | 0 | n/a | n/a | n/a |  |
| files-03 | files | completed | 0 | 0 | 0 | n/a | 316 ms | 316 ms |  |
| pages-01 | pages | completed | 0 | 0 | 0 | n/a | n/a | n/a |  |
| pages-02 | pages | completed | 0 | 0 | 0 | n/a | n/a | n/a |  |
| failover-01 | failover | completed | 0 | 0 | 0 | n/a | n/a | n/a |  |
| failover-02 | failover | completed | 0 | 0 | 0 | n/a | n/a | n/a |  |
| cancel-01 | cancel | completed | 0 | 0 | 0 | n/a | n/a | n/a | idle 469 ms after Stop |
| cancel-02 | cancel | completed | 0 | 0 | 0 | n/a | n/a | n/a | idle 463 ms after Stop |
| cancel-03 | cancel | completed | 0 | 0 | 0 | n/a | n/a | n/a | idle 464 ms after Stop |
| reconnect-01 | reconnect | completed | 0 | 0 | 0 | n/a | n/a | n/a | resumed=true replayed=1 |
| reconnect-02 | reconnect | completed | 0 | 0 | 0 | n/a | n/a | n/a | resumed=false replayed=0 |
| restart-01 | restart | completed | 0 | 0 | 0 | recovered | n/a | n/a | SIGTERM: the turn resumed after the restart; userKept=true cutRowShown=true answeredAfterResume=true |
| restart-02 | restart | completed | 0 | 0 | 0 | recovered | n/a | n/a | SIGKILL: no resume after the restart; userKept=true cutRowShown=true answeredAfterResume=false |
| restart-03 | restart | completed | 0 | 0 | 0 | recovered | n/a | n/a | SIGKILL: no resume after the restart; userKept=true cutRowShown=true answeredAfterResume=false; the message sent behind the turn was delivered |
| restart-04 | restart | completed | 0 | 0 | 0 | recovered | n/a | n/a | SIGTERM: the turn resumed after the restart; userKept=true cutRowShown=true answeredAfterResume=true; the message sent behind the turn was delivered |
| concurrent-01 | concurrent | completed | 0 | 0 | 0 | n/a | 920 ms | 920 ms |  |
| concurrent-02 | concurrent | completed | 0 | 0 | 0 | n/a | n/a | n/a |  |
| concurrent-03 | concurrent | completed | 0 | 0 | 0 | n/a | n/a | n/a |  |

## Defects

None recorded.
