# Pi orchestration operations

This directory owns the Pi peer-mesh configuration and extension runtime. The
current configuration writes new meshes below
`$XDG_STATE_HOME/pi/orchestration-v9` (normally
`~/.local/state/pi/orchestration-v9`).

## v9 cutover

Changed owned formats accept only the new version. There is no reader that
infers, backfills, or resumes an old form. Old state is not deleted
automatically; see `docs/compatibility-policy.md`.

1. In the old Pi session, finish or stop every old mesh task before activating
   the v9 configuration.
2. Activate the configuration and start a new root Pi session and mesh.
3. Do not resume an old Pi session or mix an old mesh with a v9 mesh.
4. The old state directory and user-created artifacts remain until you archive
   or remove them after checking their contents.

A generated `orchestration.json` whose `stateRoot` ends in
`/pi/orchestration-v9` confirms the new state root. It does not migrate or
validate an old session.

## Public delegation contract

A new `mesh_send` call is `{ agent, access, message }`. `agent` is a public
call name. `access` is `read` or `write` on every new call, including
research, perspective, and search. The public schema exposes only the
`(agent, access)` pairs the caller is allowed to use. Execution rejects a
missing or invalid `access` and does not fill it from the current mode. Mode
selects the authorized candidate set; ops may still choose an authorized read
role.

An existing-agent intervention remains `{ agentId, message }`. Do not combine
that form with `agent`, `access`, or `profile`. Internal role IDs and
execution profiles stay off the public call surface.

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

The parent remains responsible for integrating evidence, checking the relevant
diff and validation, and deciding whether the request is actually complete.

## Selectors and internal IDs

The `roles` attribute key is the internal role ID. `selector.agent` is the
public call name. Runtime `agentId` identifies one live agent, not a role
kind.

A role whose `selector.agent` is `search` is not published on a root caller.
Only a caller whose internal role key is `research` may have a search edge.
That restriction stays an internal-ID test; do not rewrite it as a check of
the caller's public call name.

CallPolicy keeps one profile per edge, unique selectors per caller, and
rejection of unknown role or profile references. Callers with outbound edges
must execute through Pi profiles. Prompt-only roles are leaves and may use
only Pi profiles.

## Harness coverage

Cursor profiles accept only the approved read and write `harnessOptions`
combinations. Codex profiles accept only the current read-only cached
combination. These are not passthrough interfaces for arbitrary upstream
flags.

Change Cursor CLI alias to ACP model ID mapping on
`programs.pi-coding-agent.cursorAcpModelIds` in the parent feature owner.
Keys are CLI aliases without a `cursor/` prefix. Every in-use Cursor profile
alias must have a mapping; unused entries are allowed. Launch resolves the
alias once and reuses that ACP ID for worker config, the agent record, and
diagnostic redaction. The driver still passes the CLI alias to Cursor.

## Host and Web tuning

Orchestration budgets and per-role GC defaults are host-overridable
`mkDefault` values. GC timing keeps the existing option defaults; host files
may assign a subset of budgets or GC values at normal priority. Do not add a
separate host policy module for those knobs. GC still requires a policy for
every role, and its comparison relationships stay the same.

Tune Web routing weights, search/fetch deadlines, and retry wait through
`programs.pi-coding-agent.web_retrieval`. Providers, endpoints, credential
paths, and the single retry remain fixed. Retry count is not an option.

## Parent profile and skills

The parent `/profile` command can select any execution profile whose harness
is `pi`. A mode `defaultProfile` is the initial profile, not a restriction on
later selection.

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
