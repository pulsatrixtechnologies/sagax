# Credential matrix

One place to see which form serves which aspect (#5180). The table in
code is `shared/credential-matrix.ts`. It does not resolve a key. Each
resolver keeps its own order (`docs/credential-order.md`).

| Form | Text | Image | Realtime | Speech | Phone line | Connectors |
| --- | --- | --- | --- | --- | --- | --- |
| Personal account | `subscription` | `grok-account` | `grok-account` | `grok-account` | `grok-account` | own account connectors |
| Organization account | `org-account` (Grok) | `org-account` | `org-account` | `org-account` | `org-account` | own account connectors |
| Personal API key | `speaker-key` | `perspicax-key` | `voice-key`, `perspicax-key` | same | same, kept in the list | hub, not account connectors |
| Organization API key | `org-key` | `org-key` | `org-key` | `org-key` | `org-key`, kept in the list | hub, not account connectors |

Realtime, speech and the phone line share `resolveVoiceKeys`. The app
asks before a paid key. The phone line passes `phoneLine`, so the list
stays the full order for that person (D-20261127-029).

Live surfaces stay the ones that already exist. Turn access names the
text form of a turn. `GET /api/bots/<id>/voice/status` names the voice
list. There is no second endpoint that probes all six again.

Video generation (`server/video/video-credentials.ts`) is not one of
these six aspects. It still takes an API key only.

Proof: `server/credentials/credential-matrix.test.ts`.
