# Pi orchestration operations

This directory owns the Pi peer-mesh configuration and extension runtime. The
current configuration writes new meshes below
`$XDG_STATE_HOME/pi/orchestration-v11` (normally
`~/.local/state/pi/orchestration-v11`).

## v11 cutover

Changed owned formats accept only the new version. There is no reader that
infers, backfills, or resumes an old form. Old state is not deleted
automatically; see `docs/compatibility-policy.md`. Crash or process
replacement keeps recorded holds and task identity; it does not reconstruct
the in-process run or replay work.

1. In the old Pi session, finish or stop every old mesh task before activating
   the v11 configuration.
2. Activate the configuration and start a new root Pi session and mesh.
3. Do not resume an old Pi session or mix an old mesh with a v11 mesh.
4. The old state directory and user-created artifacts remain until you archive
   or remove them after checking their contents.

A generated `orchestration.json` whose `stateRoot` ends in
`/pi/orchestration-v11` confirms the new state root. It does not migrate or
validate an old session.

## Reading child work

In `/mesh`, select a child and press the configured `meshPalette.history` key
(default `h`) to browse its tasks and messages, including acknowledged messages.
Enter opens the selected record's full body; arrows and Page Up/Down scroll it.
Escape returns one view at a time, preserving the selection. The mesh list's
existing Enter session-opening, Space preview, and stop actions are unchanged.

History is read-only: opening it does not acknowledge messages, retrieve task
results for the model, or change task state. An intake acknowledgment means a
follow-up entered model context, not agreement or task completion. Missing or
malformed records are reported while readable records remain available.

## Public delegation contract

A new `mesh_send` call is `{ agent, access, purpose, message }`. `agent` is a public
call name. `access` is `read` or `write` on every new call, including
research, perspective, and search. `purpose` is a short display name for that
new task: control characters are rejected even at the edges; after
ordinary whitespace trim, 1–120 Unicode code points on a single line.
The public schema exposes only the `(agent, access)` pairs
the caller is allowed to use. Execution rejects a missing or invalid `access`
and does not fill it from the current mode. Mode selects the authorized
candidate set; ops may still choose an authorized read child.

An existing-agent call is `{ agentId, purpose?, message }`. New work on an idle
child requires `purpose`. Follow-ups to an active task may omit it and never
change the stored purpose. Retrying the same `toolCallId` reproduces the
original admission result. Do not combine the existing-agent form with `agent`
or `access`. Internal child IDs and execution settings stay off the public
call surface.

After `mesh_send`, continue useful independent work, then yield with a
standalone `end_response({})`. That call ends the current model response; it
is not a success claim and does not finish the mesh task. Orchestration then
keeps the same Pi `AgentSession` run open while delegated tasks or queued
notifications remain. Mixed batches that call `end_response` with other tools
are rejected so the model can yield alone later. A normal `stop`, or a
successful standalone `end_response`, is joinable; arbitrary `toolUse`,
`error`, `length`, and abort are not rewritten as a clean end.

A completion notification that wakes a waiting or idle caller includes compact
results for those tasks. User input that wins the same wake does not auto-include
results; retrieve them with `mesh_get`. When a compact notification already
included a result, skip the immediate `mesh_get` unless `fullOutputAvailable`
is set. Child usage is counted once per task in mesh totals and is separate
from Pi's own usage line. External children without usage capabilities show as
unknown, not zero.

`mesh_control({ agentId, action })` pauses, interrupts, or resumes a direct
child and its descendants without finishing their tasks. `/mesh pause`,
`/mesh interrupt`, and `/mesh resume` do the same from the user; omit the
agent id to target the current Pi and its descendants. Palette stop no longer
asks for a reason; pause, interrupt, resume, and stop remain distinct actions.
External ACP children report pause as unsupported. Usage-limit holds on a
child stay until an explicit user resume.

The join is process-local and is cleared by drain, abort, endpoint replacement,
or shutdown. Aborting the caller does not stop its delegates; unacknowledged
notifications cleared from Pi's queue become eligible for normal asynchronous
delivery after settlement. Stop delegates explicitly with `mesh_stop` if needed.
Waiting uses the status line without replacing the editor or changing its draft,
cursor, or focus. Enter and the configured follow-up binding (Ctrl+Enter in this
repository) retain native steering and follow-up input.
The join is not restored after restart. Error and length recovery are not
blocked by the wait hook. Keeping the Pi session run active does not keep an HTTP
request open and does not guarantee that a provider treats later requests as one
billing or subscription turn.

`access` is a work contract and routing label, not an operating-system
sandbox. It authorizes whether the assignment may change source and
configuration.

- `small` is for low-judgment bounded work.
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

The parent considers delegation first and prefers it when uncertain. It remains
responsible for integrating evidence, checking the relevant diff and
validation, and deciding whether the request is actually complete. Necessary
authorized direct investigation and edits remain allowed.

## Selectors and internal IDs

The `children` attribute key is the internal child ID. `selector.agent` is the
public call name. Runtime `agentId` identifies one live agent, not a child
kind.

A child whose `selector.agent` is `search` is not published on a root caller.
Only a caller whose internal child key is `research` may have a search edge.
That restriction stays an internal-ID test; do not rewrite it as a check of
the caller's public call name.

CallPolicy keeps unique selectors per caller and rejection of unknown child
references. Callers with outbound edges must execute through Pi. Prompt-only
children are leaves and must execute through Pi.

## Harness coverage

Cursor children accept only the approved read and write `harnessOptions`
combinations. Codex children accept only the current read-only cached
combination. These are not passthrough interfaces for arbitrary upstream
flags.

Change Cursor CLI alias to ACP model ID mapping on
`programs.pi-coding-agent.cursorAcpModelIds` in the parent feature owner.
Keys are CLI aliases without a `cursor/` prefix. Every in-use Cursor child
alias must have a mapping; unused entries are allowed. Launch resolves the
alias once and reuses that ACP ID for worker config, the agent record, and
diagnostic redaction. The driver still passes the CLI alias to Cursor.

## Host and Web tuning

Orchestration budgets and per-child GC defaults are host-overridable
`mkDefault` values. GC timing keeps the existing option defaults; host files
may assign a subset of budgets or GC values at normal priority. Do not add a
separate host policy module for those knobs. Every child carries its own GC
policy, and its comparison relationships stay the same.

Tune Web routing weights, search/fetch deadlines, and retry wait through
`programs.pi-coding-agent.web_retrieval`. Providers, endpoints, credential
paths, and the single retry remain fixed. Retry count is not an option.

## Parent execution and skills

Mode apply uses that mode's inline Pi execution. `/model` and `/thinking`
remain available; an explicit override suspends automatic fallback until the
next mode apply. There is no parent `/profile` command.

`skillOptIns` additionally publishes discovered Skills that set
`disable-model-invocation`. It is not an allowlist that hides ordinary
Skills.

## Performance threshold

The displayed compaction threshold is computed from file-backed Pi settings
and the observed context window, not from a live compaction measurement. The
extension reads reserve tokens through Pi's public `SettingsManager` using
the current working directory, agent directory, and project-trust flag.
Trusted project settings follow that manager's merge. An official
`SettingsManager` default is a valid settings value; a missing settings file
is not unknown when that default is returned. Fetch exceptions, reported
read errors, and values that are not finite and non-negative make that
observation unknown; the known window and peak tokens remain, and a previous
threshold is not carried forward. Do not substitute a repository `16384`
constant.

## Operational limits

A `read` capability is a work contract, not an operating-system sandbox. Pi
read roles can run their permitted shell tools, and builds, caches, or
external commands may still write outside the intended source/configuration
change. Use stronger isolation only as a separately scoped feature.

The standard external child uses Cursor's advertised ACP tools, not Pi's
`read`, `grep`, `find`, `ls`, or `bash` tools. Do not promise arbitrary shell
access or local validation from `standard/read`; return the missing operation
to the parent so it can use another authorized capability. A requested ACP
permission or mode that the endpoint does not advertise is a route failure; it
must not silently become a write operation or cross-harness fallback.

The Codex ACP `search` child is Web-search-only. Reachability follows the
internal-ID restriction above. External service availability and
API-advertised capabilities are runtime conditions, not guarantees supplied
by the role description.
