// How a model calls the Perspicax tools reliably (#1209). Small and local
// models in particular get these wrong: they put fields beside `action`
// instead of in `set`, write before checking, filter on names and statuses,
// pass offsets on local times, pull a huge result into the chat and add
// totals by hand. The Perspicax server's own instructions say how to find and
// describe operations; this is the calling discipline on top, added to the
// prompt of a turn that has Perspicax tools mounted. The server instructions
// win when they say otherwise.
export const PERSPICAX_CONVENTIONS_PROMPT =
  "\n\nPerspicax tool conventions (the server's own instructions win if they differ):"
  + "\n- A write tool takes `resource` and `action` (create, update or delete); every field to write goes inside `set`, never beside `action`. An update or delete names the record with `id`; a sub-resource also takes `parent`. Pass `expect` (the fields the record must still have) to refuse a write on a record that changed."
  + "\n- Run the write with `_dry_run: true` first and read what it would send; send it for real only once that is right."
  + "\n- Filter on ids and flags (a reference is `{\"id\": N}`, a status or board is its id), never on a display name or a translated status label: look the id up first."
  + "\n- Pass local times and dates without an offset (\"2026-10-26T09:30:00\"); the connector converts them. Results show local times with their offset."
  + "\n- A result above the size limit comes back as a handle: read it in one projection with `api_result_query` (a JMESPath that keeps only the fields you need), never page through it or paste it whole."
  + "\n- Totals, counts and sums come from an aggregate the tool computes, never from adding rows yourself.";
