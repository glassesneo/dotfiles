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

Follow-ups and reports arrive in the receiving Pi conversation as full text:
the sender, direction, and kind stay on a short header line and the body below
uses the same message component as a user prompt with no truncation. Scroll a
long body normally; there is no separate history screen, `h` key, collapse
control, or remainder pointer. Sending, delivery acknowledgment, and completion
cards keep their existing summaries.

Enter still opens the selected live child window, Space still previews it, and
stop/pause/interrupt/resume still act on it. Finished Pi sessions remain
readable through the existing session file in a terminal Pi run. There is no
Unlink action; every linked view closes with the agent window.

Child usage is counted once per task in mesh totals and is separate
from Pi's own usage line. External children without usage capabilities show as
unknown, not zero. The mesh list no longer shows a combined child-token total;
per-task and per-agent usage stay on the detail pane, receipts, and results.

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
is set.

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
  the Pi harness with the repository read (and, for write, edit) tools.
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

## Parent modes, execution, and skills

The parent has one Pi execution shared by `recon`, `leader`, and `ops`.
`recon` investigates without source edits, `leader` keeps the parent read-only
while delegating implementation and reviewing its evidence, and `ops` permits
direct implementation. Mode switching changes authority, tools, and
instructions only; it does not change the model or thinking level, reset the
route, or restart suspended fallback.

`/model` and `/thinking` remain available. Either explicit override stops
automatic parent fallback for the rest of the current session branch. Reload,
resume, tree navigation, and mode changes preserve that stopped state; a new
session initializes fallback from the common execution again. There is no
parent `/profile` command.

`skillOptIns` additionally publishes discovered Skills that set
`disable-model-invocation`. It is not an allowlist that hides ordinary
Skills.

### Parent transitions: `switch_mode` and `session_handoff`

`recon`, `leader`, and `ops` also decide whether the parent may become an
implementer at all, so switching to or from `ops` changes what the delegated
work may assume. Both `switch_mode` and `session_handoff` therefore run one
shared, serialized transition with the mesh instead of flipping state in
place:

1. The caller prepares a transition. The mesh must be quiescent (no
   non-terminal agents, tasks, reservations, pressure admissions, or
   unacknowledged completion deliveries), and a transition fence is written
   under the mesh lock. While the fence exists, new tasks, agent
   preparation, mesh-send submissions, and pressure claims are refused; lease
   heartbeats and release paths stay available.
2. The parent side applies its half (tools, identity, session entry; for a
   handoff, the new session and its kickoff). The mesh side applies the target
   policy epoch for a mode switch. Results correlate by request ID, and only
   success releases the fence.
3. Failure rolls back the parent side and leaves the fence in place, keeping
   mesh mutations suspended until the user resolves the failure. A session
   handoff keeps its fence until the old session's mesh close, and a fence
   never auto-deletes crash residue.

`switch_mode` and `session_handoff` must each be the only tool call in their
batch. Both tools only schedule: they reserve a pending request, end the
current model response, and defer the actual transition to the internal
`/mode-switch` or `/mesh-handoff` command, which revalidates at the command
boundary (idle, same session) after the turn settles. Manual `/mode` and the
command palette share the same serialized coordinator, whose parent-side
failure path rolls the mode back while the mesh fence stays in place. The
`session_handoff` tool validates the prompt and the core editor draft, opens
the native editor with the prompt prefilled, and the command starts a fresh
session in `ops` mode with the confirmed text as an unsubmitted draft, linked
to the old session as its parent; the old root closes its own mesh during
shutdown. Pending requests expire, and tree navigation, reload, replacement,
or shutdown invalidate them. Tree operations are rejected while a fence exists
or while mesh work is not quiescent.
`leader` is the delegation boundary where the parent must not become an
implementer; `ops` is the only mode that lets the parent implement directly.

## Child extension composition

`programs.pi-coding-agent.orchestration.commonChildExtensionContributions`
carries trusted Pi child package paths shared by every Pi child;
`children.<childId>.childExtensionContributions` carries role-specific paths.
Generation composes `common ++ role` with duplicates removed, common first, for
`execution.harness == "pi"` children only. External-harness children keep
only their role list.

Set installed absolute package paths (for example the local Command Code
package root contributed by `programs.pi-coding-agent` when the existing
`commandcode-provider` package contribution is enabled), never npm sources or
versions. The package source/version pin stays owned by
`programs.pi-coding-agent.packageContributions`. Narrow Nix assertions reject
empty or non-absolute entries on both lists; runtime paths are not checked
during evaluation.

The composed list becomes the stored `childExtensionContributions`, so policy
digest and epoch selection already observe common-set changes. The launcher
passes the resulting manifest to Pi as ordered `-e` arguments under
`--no-extensions`; `prompt-only` keeps its manifest and still launches with
`--no-context-files --no-skills --no-prompt-templates --no-tools`. Added
extensions never widen role `tools`, and a `mesh_send` caller must also load
the provider that registers the selected model. Only add extensions whose
hooks and tool behavior stay compatible with the child's context and tool
policy. Apply the configuration, reconcile packages in a fresh parent Pi
session and mesh, and verify launch arguments there.

## Per-child context retirement

`programs.pi-coding-agent.orchestration.children.<childId>.gc.retireOnContextPressure`
is a boolean (default true) that decides whether reaching the context-headroom
threshold retires that child. `false` keeps a threshold-reached child reusable:
it still accepts the next task when ordinary idle conditions hold, while
unknown or stale observations, running state, pending messages, stops, holds,
and count- or pressure-based GC still apply. Observed context values are not
rewritten and `retirementReason` is set only for an effective retirement.

Initial values:

| child | retireOnContextPressure |
|---|---|
| small-write, advanced-read, advanced-write, research | false |
| small-read, perspective, standard-read, standard-write, search | true |

Host files may override any child at normal priority; no separate host policy
module is needed. An explicit boolean changes the child definition digest, so
a new epoch or child may be selected; omission always means true and is never
normalized into stored digests.

## Applying this configuration

Finish or stop every old mesh task before activating the new configuration,
then start a new parent Pi session and a new mesh. Do not resume an old Pi
session or an old mesh. Existing events without sender session identity,
removed signal records, and meshes carrying the old budget-migration marker
are not completed, converted, or deleted automatically, and no new state root
splits them: they stay unreadable until archived or removed after checking
their contents.

## Operational limits

A `read` capability is a work contract, not an operating-system sandbox. Pi
read roles can run their permitted shell tools, and builds, caches, or
external commands may still write outside the intended source/configuration
change. Use stronger isolation only as a separately scoped feature.

The Codex ACP `search` child is Web-search-only. Reachability follows the
internal-ID restriction above. External service availability and
API-advertised capabilities are runtime conditions, not guarantees supplied
by the role description.
