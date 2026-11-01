# Pulsatrix Flow plugin: mapping to Perspicax pack tools

The marketplace plugin `pulsatrix-flow` (0.20.15, `plugins/pulsatrix-flow` of
the marketplace repository) brings skills, two sub-agents, two hooks, a
library of declarative actions and a helper script (`scripts/px_flow.py`,
`scripts/px_flow_action.py`). This page maps each of them to Sagax.

## Where `flow` and `flow_action` live

Sagax does not implement `flow` or `flow_action`. Perspicax serves them
(connector crate, `crates/connector/src/mcp/flow_tools.rs`, runner in
`crates/connector-core/src/flow/`): `flow` lists the active signed pack's
actions (`catalog`) and describes one (`describe`); `flow_action` runs one
action through a bounded loop (reads, then one write batch behind
`needs_confirmation`, `choice_needed` and `resume`), with `px_flow.py serve`
as the pack's runner. They reach a bot through the Perspicax profile servers
Sagax mounts for the person who speaks (`perspicax_<profile>`,
`server/perspicax-mcp-bridge.ts`). Sagax only relays them: misuse
classification marks a frame naming `flow_action` as surface `flow`
(`server/index.ts`), and the existing profile authorization applies. Grok and Claude keep
read-only treatment for the eight pure compute tools only on harness-owned
Perspicax bridges (`server/drivers/acp/grok-read-only-tools.ts`).

## Compute belongs to the signed Python pack

The eight tools are served by Perspicax from the active signed Flow pack,
through `scripts/px_flow.py serve` (`compute.catalog`, `compute.call`).
`flow_compute_tools.json` is the only schema catalog and
`px_flow_compute.py` is the Python implementation. Sagax has no local
`sagax-flow` server or duplicate TypeScript calculation.

- Every organization fact is an argument: time zone, working hours,
  holidays, midnight split time and input records. Compute reads no tenant
  facts, business files or network, and writes nothing.
- A selected profile linked to the active pack offers the tools. The caller
  remains the turn's actual speaker, exactly as for other Perspicax tools.
- Older packs offer no compute tools. Sagax does not manufacture support.
- The tool answer preserves its fields and adds pack digest and versions.
- The standard-library Python NFA preserves bounded non-backtracking
  conditions and title motifs. The host runner retains its normal timeout.
- Read-only exceptions name these exact tools on harness-owned Perspicax
  bridges only. Third-party annotations and the retired mount grant none.

| Tool | Ported from | What it computes |
|---|---|---|
| `flow_free_slots` | `px_flow_action.free_slots` (the `free_slots` list op) | Free holes of one person's schedule: working window per weekday (calendar or default window), minus occupying items, whole-day items, holidays, lunch and busy intervals; starts on the grid; earliest first, one per hole |
| `flow_time_block` | `utc_at`, `next_day`, the midnight split of `time-entry-write` | A local block as UTC rows, daylight saving aware; a block whose end is at or before its start becomes two rows (the first ending at `midnight_split_end`, which the caller must pass); optional overlaps with existing entries |
| `flow_overlaps` | `_overlap_count` | Items whose [start, end) overlaps an interval; date-only items never do |
| `flow_stats` | `_median`, `pluck`, the `no-mental-math` rule | Exact count, sum, min, max, mean and median (decimal, not float) |
| `flow_age_buckets` | the age buckets of `reporting-ticket-aging` / `ticket-aging-report` | Counts and shares by local days since a date field; bounds configurable (default 7, 30, 90) |
| `flow_group_units` | `similar_key`, `group_sets`, `group_slug`, the union-find and lots of `plan` | Groups of units by key sets or alternatives, `similar` key (sender, normalized subject, devices and serials), `group_max` lots; ids never spell an address |
| `flow_filter` | `eval_condition`, `_mark_excluded`, `_title_motif` | The routines' condition language (`is set`, `~`, `in`, `>`, `newer than`, ...) as where/unless filters, plus exclusion by id or title motif |
| `flow_member_load` | `pool_load`, `load_window`, `member_load` | Booked hours per person and local day, cut at local midnight; a person's window over the next business days; least loaded first |

The pack's 54 parity cases preserve the former public answers, including
decimals, DST, midnight splitting, grouping, filters, age buckets and load.
Sagax's real-turn test proves only the relay and speaker identity; it does
not reimplement the calculations.

## Mapping

Status: **migrated** (a native Sagax tool does it), **depends on plugin**
(still the plugin's, or the pack Perspicax serves from it), **not
migrating** (with the reason).

### `flow` and `flow_action` (Perspicax)

| Old | New | Status |
|---|---|---|
| `flow` `catalog` | (relayed `perspicax_<profile>` `flow`) | depends on plugin: the catalog is the signed pack's, per tenant |
| `flow` `describe` | (relayed) | depends on plugin: same |
| `flow_action` `{name, params}`, `_dry_run`, `confirm` | (relayed) | depends on plugin: the bounded loop, confirmations, audit and write batches belong to Perspicax |
| `flow_action` `resume {run_id, choice}` | (relayed) | depends on plugin: paused runs are stored by Perspicax |

### Actions (`library/<product>/<domain>/actions/*.json`, run by `flow_action`)

Each action is a tenant-bound sequence of vendor reads and writes, with
tenant facts (`{{fact:...}}`), confirmation gates and choice points. They stay
in the pack Perspicax runs. Where an action's arithmetic now has a native
tool, a bot working by hand (no pack, or a shadow comparison) can do that
part with it.

| Action | Writes | Native tool for its computation | Status |
|---|---|---|---|
| `free-slot-find` | no | `flow_free_slots` | depends on plugin (reads); computation migrated |
| `fixed-date-slot` | yes, choice | `flow_free_slots` | depends on plugin; computation migrated |
| `waiting-follow-up` | yes, choice | `flow_free_slots` | depends on plugin; computation migrated |
| `unassigned-worker` | yes, choice | `flow_free_slots` | depends on plugin; computation migrated |
| `slot-duration-estimate` | no | `flow_stats` (exact median of a field) | depends on plugin (reads); computation migrated |
| `ticket-aging-report` | no | `flow_age_buckets` | depends on plugin (reads); computation migrated |
| `time-entry-write` | yes | `flow_time_block`, `flow_overlaps` | depends on plugin; computation migrated |
| `activities-past-close` | yes | `flow_filter` (exclusion by id and title motif) | depends on plugin; computation migrated |
| `schedule-slot-create`, `child-closure-eval` (choice) | yes | none | depends on plugin |
| `dispatch-pass-plan`, `dispatch-day-listing`, `skill-candidates` | no | none | depends on plugin |
| `time-window-map`, `team-time-sweep` | no | none | depends on plugin |
| `timesheet-audit` (choice), `timesheet-submit` | yes | none | depends on plugin |
| `reply-watch-scan` | no | none | depends on plugin |
| `reply-fit-check` | no, choice | none | depends on plugin |
| `ticket-dossier`, `ticket-configurations`, `assigned-tickets` | no | none | depends on plugin |
| `ticket-create` (choice), `ticket-note-add`, `ticket-status-set`, `ticket-summary-set`, `ticket-task-write` | yes | none | depends on plugin |
| `board-catalog`, `company-card`, `company-open-tickets`, `morning-brief` | no | none | depends on plugin |
| `invoice-qc-dossier`, `ar-overdue-report` | no | none | depends on plugin |
| `invoice-status-watch`, `invoice-header-fix`, `invoice-to-correct`, `ticket-budget-set` | yes | none | depends on plugin |
| `agreements-reconcile` | yes, choice | none | depends on plugin |
| `test-invoice-status` | yes | none | not migrating: a lab-only action (`PX_FLOW_TEST_ACTIONS=1`) |
| `candidate-triage` | yes, choice | none | depends on plugin |
| `project-health` | no | none | depends on plugin |
| `vcio-client-data`, `vcio-ticket-slice` | no | none | depends on plugin |
| `opportunity-for-ticket` (choice), `prospect-intake` (choice), `approver-role-set`, `sales-activity-create` | yes | none | depends on plugin |
| `quote-dossier` | no | none | depends on plugin |
| `endpoint-reachability` | no, choice | none | depends on plugin |
| `s1-sites`, `threat-sweep`, `threat-dossier` | no | none | depends on plugin |
| `s1-target-action` | yes | none | depends on plugin |
| `bookstack-page-find` | no | none | depends on plugin |
| `bookstack-page-write` | yes | none | depends on plugin |
| `timezest-request-create`, `twilio-sms-send` | yes, choice | none | depends on plugin |

"none" means the action's arithmetic (if any) is not one of the ported
functions; its reads and writes stay with the pack in every case.

### Recipes (`references/recipe.json`)

| Old | New | Status |
|---|---|---|
| `px_flow.py recipe plan/render listing-dispatch-day` | none | depends on plugin: the same work is the `dispatch-day-listing` action |
| `px_flow.py recipe plan/render reporting-ticket-aging` | `flow_age_buckets` | migrated (computation); the reads are Perspicax tools |
| `recipe list` | none | not migrating: the action catalog (`flow catalog`) replaces it |

### `px_flow.py` commands

| Command | New | Status |
|---|---|---|
| `load --run --day --member` | `flow_member_load` | migrated (from entries the bot read; no run folder) |
| `snapshot schedule` (pool load part) | `flow_member_load` | migrated for the load; the snapshot itself depends on plugin |
| `snapshot schedule`, `snapshot units`, `snapshot waiting` | none | depends on plugin: they read the host's transcript and the run folder |
| `plan` (fan-out triage) | `flow_group_units`, `flow_filter` for grouping and conditions | depends on plugin: the triage reads routine definitions, run state and held tickets in `$PX_FLOW_HOME` |
| `gate` | none | depends on plugin: the gate's rules are dispatch policy of the product's routines |
| `skill resolve` | none | depends on plugin: reads the tenant's skill tables |
| `run init`, `run close`, `run usage` | none | depends on plugin: run folders, signal files and host transcripts |
| `state save`, `state load` | none | depends on plugin: durable state between routine passes |
| `bb get/set/claim/release/send/inbox/result/finish` | none | depends on plugin: the blackboard of one run's sub-agents; Sagax coordinates bots with its own tools (`coordinate_bots`, `start_thread`, parallel tasks) |
| `prompt` | none | depends on plugin: renders worker and aggregator prompt files |
| `journal append/pass/proof/mirror/read/summary` | none | depends on plugin: the journal format and files are the product's |
| `proof check` | none | depends on plugin |
| `signal` | none | depends on plugin: reads the run's plan and today's journal |
| `verify` | none | depends on plugin: checks results against the run's claims and journal |
| `kb get/put/status/refresh/snapshot` | none | depends on plugin: a cache of the tenant's configuration |
| `viewer-backup prepare/verify`, `viewer-retention plan` | none | not migrating: maintenance of the dispatch viewer artifact database on the host |
| `eval start/save/finish/...` | none | not migrating: the plugin's skill evaluation harness, a development tool |
| `validate`, `validate --tenant` | none | not migrating: repository and tenant CI checks of the plugin |
| `doctor` | none | not migrating: readiness of a local Python host; Sagax reports its own engines and Perspicax link |
| `tenant show/init/fixture` | none | not migrating: organization configuration discovery and scaffolding |
| `reference <topic>` | none | not migrating: organization facts; they stay in the organization's configuration plugin |
| `catalog`, `clients`, `show`, `rules` | none | depends on plugin: library content selection |
| `service-mode`, `recipe --service-mode` | none | not migrating: translates calls between Perspicax service modes, which the action runner already does |
| `profiles` | none | not migrating: deprecated since 0.15.0 (Perspicax assigns profiles) |
| `serve` | none | depends on plugin: the runner Perspicax starts for `flow_action` |
| `action list/describe/validate/plan/render` | none | depends on plugin: the pack's actions |
| `wait --seconds/--until` | none | not migrating: a bounded sleep for a host's shell; Sagax turns wait with `wait_delegation` or engine tools |

Internal helpers with no command of their own (`parse_moment`, `utc_at`,
`_median`, `_overlap_count`, `eval_condition`, `similar_key`, `group_slug`,
`_mark_excluded`, `pool_load`) are migrated inside the tools above.

### Skills

Skills are written procedures: judgment, voice, decision tables. They are
content, not logic, and Sagax already installs a plugin's skills and commands
on a bot (Capabilities, `server/bot-plugins.ts`). None is copied into Sagax.

| Skills | Status |
|---|---|
| Host components: `using-px-flow`, `running-px-flow`, `testing-px-flow-skills` | depends on plugin: routing and the multi-agent engine of the plugin |
| Method: `checking-pulsatrix-host`, `diagnosing-flow-runs`, `debugging-systematically`, `verifying-before-done`, `producing-pdf-excel-deliverables`, `scripting-from-har`, `filing-product-defects` | depends on plugin: generic prose, installable through Capabilities |
| Dispatch: `dispatching-tickets`, `choosing-dispatch-techs`, `handling-child-tickets`, `following-up-waiting-tickets`, `handling-unassigned-tickets`, `handling-critical-tickets`, `scheduling-fixed-date-requests`, `repairing-ticket-owners`, `classifying-unreadable-references`, `listing-dispatch-day`, `reporting-dispatch-to-teams`, `mirroring-dispatch-journal` | depends on plugin; their slot, load and grouping arithmetic is migrated (`flow_free_slots`, `flow_member_load`, `flow_group_units`) |
| Service: `working-service-tickets`, `diagnosing-tickets`, `finding-finishable-tickets`, `watching-client-replies` | depends on plugin |
| Finance: `managing-time-entries`, `approving-timesheets`, `validating-invoices`, `watching-invoices`, `reconciling-agreements` | depends on plugin; time-block and overlap arithmetic migrated (`flow_time_block`, `flow_overlaps`, `flow_stats`) |
| Projects, sales, HR: `managing-projects`, `handling-prospects`, `preparing-quotes`, `triaging-job-candidates` | depends on plugin |
| Reporting: `reporting-ticket-aging`, `preparing-vcio-reviews` | depends on plugin; aging buckets migrated (`flow_age_buckets`) |
| Shared: `briefing-the-day`, `looking-up-companies`, `classifying-client-communication`, `writing-in-house-voice` | depends on plugin |
| Other products: `hunting-threats`, `reporting-rmm-fleet`, `reporting-backup-health`, `checking-endpoint-reachability`, `searching-passportal`, `authoring-bookstack-pages`, `drafting-mail-in-m365`, `reconciling-sherweb-billing`, `looking-up-sherweb-customer-subscriptions`, `auditing-tailscale-devices`, `reviewing-tailscale-users-and-keys`, `checking-unifi-network-health`, `locating-unifi-clients`, `checking-threecx-system-health`, `looking-up-threecx-extensions`, `reviewing-threecx-call-history`, `creating-timezest-scheduling-requests`, `finding-ticket-scheduling-requests`, `reviewing-twilio-usage-per-client`, `investigating-twilio-delivery`, `sending-twilio-sms`, `investigating-voicemeup-line-issues`, `reviewing-voicemeup-usage-per-client` | depends on plugin |

Two skill scripts compute deterministically
(`approving-timesheets/scripts/deduct_findings.py`,
`managing-time-entries/scripts/collect_day_signals.py`). They encode
the plugin's finance rules for one vendor's records, so they stay with
their skills (depends on plugin).

### Rules, library, templates

| Old | Status |
|---|---|
| Global rules (`write-safety`, `no-secrets`, `no-mental-math`, `tenant-facts`, `connectwise-access`, `operator-voice`, `orchestrator-routing`, `product-defects`, `three-failures`, `ticket-concurrency`) | depends on plugin: injected by the plugin's engine. `no-mental-math` is now served by `flow_stats` and the other compute tools |
| Domain rules (dispatch, finance, projects, sales, service, documentation, security) | depends on plugin |
| `library/connectors/`, `library/guides/`, `library/reference/` (formats, tool tables) | depends on plugin: documentation of the product |
| `templates/tenant/`, `tests/fixtures/tenant-acme/` | not migrating: the organization configuration template and its test fixture |

### Agents and hooks

| Old | Status |
|---|---|
| `agents/px-flow-worker.md`, `agents/px-flow-aggregator.md` | depends on plugin: sub-agents of the plugin's engine. Sagax's own equivalents are bot-level (`start_thread`, `coordinate_bots`, parallel tasks) and are not a port |
| `hooks/session-start` (injects `using-px-flow`) | not migrating: Sagax strips hooks from a plugin it installs on a bot (`server/bot-plugins.ts`); Claude loads the plugin with `--plugin-dir`, other engines get its skills and commands in the turn prompt |
| `hooks/pre-tool-use.py` (always-refused list, kill switch, read-only, human approvals) | not migrating: hooks are stripped in Sagax (above). Sagax's own controls apply instead: approval modes and cards, misuse guardrails and safety review, and Perspicax's server-side profiles and confirmation holds. Its lists name the organization's tool risks, which stay in the organization's configuration |

## Data completeness

`flow_age_buckets` counts the records passed to it. Vendor reads that span
multiple pages must be completed before computing totals. Availability and
pack versions come from Perspicax; the bot's capability receipt displays
the loaded Flow identity and version.
