# Pi orchestration operations

This directory owns the Pi peer-mesh configuration and extension runtime. The
current configuration writes new meshes below
`$XDG_STATE_HOME/pi/orchestration-v8` (normally
`~/.local/state/pi/orchestration-v8`).

## v8 cutover

1. In the old Pi session, finish or stop every old mesh task before activating
   the v8 configuration.
2. Activate the configuration and start a new root Pi session and mesh.
3. Do not resume an old Pi session or mix an old mesh with a v8 mesh. There is
   no compatibility path for old role/profile state.
4. The old state directory and user-created artifacts are not deleted
   automatically. Preserve them until their work is no longer needed; remove
   or archive them manually only after checking their contents.

A generated `orchestration.json` whose `stateRoot` ends in
`/pi/orchestration-v8` confirms the new state root. It does not migrate or
validate an old session.

## Public delegation contract

The parent chooses a capability and, for repository work, an explicit access
level:

- `small` is for low-judgment bounded work. `read` leaves source and
  configuration unchanged by contract; `write` may edit them.
- `standard` is for normal repository investigation or implementation through
  the external Cursor ACP harness. Read and write use separate ACP permission
  contracts.
- `advanced` is for difficult judgment across multiple invariants and may
  delegate an authorized bounded subtask.
- `research` collects repository and Web evidence and may request the
  research-only `search` child for an independent Web path.
- `perspective` is prompt-only: it receives the parent's dossier and role
  instructions, with no repository context files, Skills, prompt templates,
  tools, routed mesh-management surface, or child delegation.

Internal execution profiles and provider/model IDs are not part of this
selection contract. The parent remains responsible for integrating evidence,
checking the relevant diff and validation, and deciding whether the request is
actually complete.

## Operational limits

A `read` capability is a work contract, not an operating-system sandbox. Pi
read roles can run their permitted shell tools, and builds, caches, or external
commands may still write outside the intended source/configuration change.
Use stronger isolation only as a separately scoped feature.

The standard external child uses Cursor's advertised ACP tools, not Pi's
`read`, `grep`, `find`, `ls`, or `bash` tools. Do not promise arbitrary shell
access or local validation from `standard/read`; return the missing operation
to the parent so it can use another authorized capability. A requested ACP
permission or mode that the endpoint does not advertise is a route failure; it
must not silently become a write operation or cross-harness fallback.

The Codex ACP `search` child is Web-search-only and can be called only by
`research`. External service availability and API-advertised capabilities are
runtime conditions, not guarantees supplied by the role description.
