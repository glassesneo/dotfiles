# Pi Coding Agent integration

This module registers project-owned extensions and prompts with Pi through Home
Manager. Deterministic extension behavior lives in `extensions/`; resource
registration and Pi's standard keybindings live in `default.nix`.

## Input and application keys

Pi's standard keymap contains no Option/Alt bindings. Normal input uses `Enter`
to submit and `Shift-Enter` for a newline. `Ctrl-C` aborts active agent or bash
work; while idle it clears non-empty input and does nothing when input is empty.
It never exits Pi. Use `Ctrl-D` to exit when the editor is empty. Terminal, tmux,
or macOS bindings own copying selected terminal text.

| Action | Key |
|---|---|
| Line start / end | `Ctrl-A` / `Ctrl-E` |
| Character left / right | `Ctrl-B` / `Ctrl-F` |
| External editor | `Ctrl-G` |
| Open command palette | `Ctrl-Shift-P` |
| Cycle thinking level | `Ctrl-T` |
| Paste image | `Ctrl-V` |
| Follow up / dequeue | `Ctrl-Enter` / `Ctrl-Up` |
| Fold / unfold tree branch | `Ctrl-Left` / `Ctrl-Right` |
| Session path / sort / named-only filter | `Ctrl-P` / `Ctrl-S` / `Ctrl-N` |
| Rename / delete session | `Ctrl-R` / `Ctrl-D` |

Arrow keys, `Home`, `End`, `Delete`, and other retained unmodified keys continue
to use Pi's defaults. `Ctrl-Enter` and `Ctrl-Up` require Ghostty's extended key
reporting; tmux must also use `extended-keys` with the `csi-u` format. Session
deletion retains Pi's `Enter` confirmation and `Esc` cancellation.

The following Pi actions are deliberately unbound: word movement and deletion,
character jumps, deletion to line start or end, `Ctrl-J` newline, yank,
yank-pop, undo, suspend, copying the last assistant message, model selection and
cycling, thinking-block and tool-output expansion, every scoped-model command,
and tree-filter cycling. The individual tree-filter shortcuts are also unbound.
`Ctrl-H`, `Ctrl-J`, `Ctrl-K`, and `Ctrl-L` are reserved for tmux and have no new
Pi assignments.

## Command Palette

`Ctrl-Shift-P` opens a centered searchable overlay that is independent of the
prompt draft. Pi's extension shortcut API owns the opening key; Kitty and tmux
must pass modified keys through without rewriting or consuming them. The palette
never reads, edits, submits, or sends editor text. It is available in TUI mode
both while the agent is idle and while it is running, and provides exactly these
actions:

- `/model` select the authenticated model
- `/thinking` select reasoning effort supported by the current model
- `/tools` configure active tools, including their source
- `/tool-output` expand or collapse tool output
- `/session` show read-only session information
- `/copy` copy the latest assistant text on the active branch
- `/theme` select the live theme

Display actions take effect immediately. Model, reasoning-effort, and active-tool
changes update the session immediately and apply to the next model request; they
do not alter or abort a provider request or tool call already in progress.

Every palette-owned list uses `Ctrl-P` to move up, `Ctrl-N` to move down,
`Enter` to select, and `Esc` or `Ctrl-C` to cancel. Selection, current and active
states, disabled reasons, status, and errors have text markers and do not rely
on color. The candidate list uses a compact fixed-height line viewport capped
at 18 rows, so filtering and status changes do not move the search input. Tool
changes apply immediately and
are not rolled back when the tool
screen closes; disabling the final active tool requires confirmation.

Home Manager installs `~/.pi/agent/command-palette-keybindings.json`. Its five
actions are `open`, `moveUp`, `moveDown`, `confirm`, and `cancel`; each value is
a complete key array. Unknown actions, invalid keys, empty required actions,
and collisions are startup errors that include the configuration path. Help is
generated from the resolved map. Run `/reload` after changing it.

## `question` tool

A call owns one draft state across all questions. Confirmed answers and
unconfirmed drafts survive forward and backward navigation. `Tab` on the last
question opens Review even when questions remain unanswered. Review shows a
Submit row followed by every answered or unanswered question. Selecting a
question reopens it; confirming that revision returns to Review. Partial
submission is allowed, and the result contains only confirmed answers.

Question kinds are `single`, `multi`, `text`, and `confirm`. Text answers must
contain a non-whitespace character. Selection questions always support notes;
omitting `note` selects answer-level note mode.

### Schema

```json
{
  "questions": [
    {
      "id": "scope",
      "prompt": "Which scope should be used?",
      "kind": "multi",
      "options": [
        { "value": "minimal", "label": "Minimal" },
        { "value": "broad", "label": "Broad" }
      ],
      "note": {
        "mode": "answer",
        "prompt": "Optional constraints",
        "placeholder": "Conditions that apply to the whole answer"
      }
    },
    {
      "id": "details",
      "prompt": "Describe additional requirements.",
      "kind": "text",
      "initialValue": ""
    }
  ]
}
```

`note.mode` is `answer` or `per-option`. `answer` stores one note on the answer;
`per-option` stores notes on selected option entries. `confirm` supports only
answer mode, and `text` does not accept `note`. Blank notes are omitted.
`notePlaceholder` is removed and is a validation error; there is no legacy
schema or answer conversion.

A multi answer in default answer mode is:

```json
{
  "kind": "multi",
  "values": [{ "value": "minimal" }],
  "note": "Keep the public interface stable"
}
```

In per-option mode it is:

```json
{
  "kind": "multi",
  "values": [
    { "value": "minimal", "note": "Apply first" },
    { "value": "broad" }
  ]
}
```

The result status is `answered`, `cancelled`, or `unavailable`. `content` and
`details` contain the same structured payload. An `answered` result may contain
fewer answers than the input contains; absent IDs are unanswered. Cancellation
preserves only confirmed answers and identifies the current question when
cancellation occurs from a question screen.

Pi's tool call display lists each question prompt. Its result display lists each
prompt with the selected label, text, Yes/No value, notes, or `Unanswered`, so
the useful content remains visible after the custom question screen closes.

### TUI controls

| Context | Keys |
|---|---|
| All question screens | `Tab` next (Review after the last), `Shift-Tab` previous, `Esc` back, `Ctrl-C` cancel all |
| `single` | `Up`/`k` and `Down`/`j` move, `Space` select without confirming, `Enter` confirm, `e` edit note |
| `multi` | `Up`/`k` and `Down`/`j` move, `Space` toggle, `Enter` confirm set, `e` edit note |
| `confirm` | `Up`/`k` and `Down`/`j` move, `Enter` confirm, `y`/`n` directly confirm, `e` edit note |
| `text` | `Enter` confirm, `Shift-Enter`/`Ctrl-J` newline |
| Note editor | `Enter` save, `Shift-Enter`/`Ctrl-J` newline, `Esc` discard |
| Review | `Up`/`k` and `Down`/`j` rows, `Tab`/`Shift-Tab` question rows, `Enter` activate, `Esc` reopen last question |

`e` only opens the note editor. Saving a non-empty per-option note selects its
target as a draft without confirming the question; answer-level notes do not
change selection. After saving, the first non-empty note line is shown beside
its answer or option without reopening the editor. `Esc` from an initial
question does not cancel the call and displays the `Ctrl-C` instruction. Text
and note editor focus is propagated for IME cursor positioning. Status,
selection, errors, notes, answered/unanswered counts, and Submit availability
are shown in text as well as color. Single and confirm choices use radio-button
markers; multi choices use checkbox markers.

When an unanswered question is completed from Review, focus moves to the next
unanswered question; completing the final unanswered question moves focus to
Submit. Revising an already answered question, or discarding an edit with
`Esc`, keeps focus on that question row.

RPC uses Pi's standard selectors and editors. `Review answers now` skips the
remaining questions; text questions first offer an answer-or-review selector.
Answer mode opens one note editor per answer; per-option mode opens one for each
selected option. Review can submit partial answers or reopen answered and
unanswered questions. Revision, explicit submission, and cancellation use the
same schema as the TUI.

### Question keymap configuration

Home Manager installs `~/.pi/agent/question-keybindings.json`. The file has the
seven contexts `question.single`, `question.multi`, `question.confirm`,
`question.text`, `question.note`, `question.review`, and `question.common`.
An action supplied in a context replaces its complete default key array;
omitted actions inherit defaults, including Pi's injected submit, newline, and
selection bindings.

The extension rejects unknown contexts/actions, invalid keys, empty required
actions, and same-context collisions. Help is generated from the resolved map.
Run `/reload` after editing either keybinding file.

Modal list search, printable list commands, filter menus, and the `Alt-S`
session menu remain postponed because Pi 0.80.7 does not expose the required
replacement APIs.

## `save_agent_artifact` tool

`save_agent_artifact` owns the approval lifecycle for repository-local spec and
plan artifacts. The specification and planning Skills pass a completed Markdown
body directly to the tool, rather than printing the full candidate in chat and
asking for a separate body-approval question. The pending artifact review is the
single candidate-approval and final-promotion gate; specification and plan
artifacts still require independent approvals.

The tool first writes content under `.agents/pending-artifacts/` with a JSON
metadata sidecar containing kind, slug, title, summary, state, pending path,
planned final path, timestamps, line count, and file size. Summary extraction
prefers the first non-empty paragraph in `## Summary`, joins its wrapped lines,
and truncates it to 180 characters. If that section is absent or empty, the tool
uses the first useful body paragraph while excluding headings, fences,
horizontal rules, and metadata such as `Status:`. In TUI and RPC modes it then
shows kind, title, summary, paths, line count, and file size in a review screen
with approve, request revision, reject, and full-text view actions. Full-text
view reads the saved pending file.

Approval promotes the pending Markdown file into `.agents/specs/` or
`.agents/plans/` and reports `finalPath`. Revision requests keep the same
pending artifact, mark it `revision_requested`, and return `pendingId`,
`pendingPath`, `plannedFinalPath`, and the user's instructions; the next model
action should read/edit that same pending file and call the tool again with the
same `pendingId`. Rejection does not create a final artifact. Print/JSON modes
fail closed for approval-required artifacts: a pending file may be left for
manual recovery, but no final spec or plan is saved. After approval, the thin
`/spec` and `/plan` prompts report their approved artifact path; `/strategy`
reports both paths when planning completes and only the specification path when
it stops before planning.

## Development

```sh
cd modules/programs/pi-coding-agent
nix develop ../../.. --command npm run check
```

For a TUI smoke test:

```sh
nix develop ../../.. --command npx pi \
  --extension ./extensions/interaction_policy.ts \
  --extension ./extensions/command_palette.ts \
  --extension ./extensions/question.ts
```

New files must be git-tracked before flake evaluation because flakes cannot read
untracked files. Manually verify normal-input `Ctrl-C`, Japanese IME cursor
placement, multiline editing, reverse navigation, review revision, and `/reload`
help updates. For the palette, also verify draft preservation and `Ctrl-P` /
`Ctrl-N` delivery in Ghostty and tmux.
