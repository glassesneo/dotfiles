# Pi Coding Agent integration

This module registers project-owned extensions and prompts with Pi through Home
Manager. Deterministic extension behavior lives in `extensions/`; resource
registration and Pi's standard keybindings live in `default.nix`.

## Input and application keys

Normal input uses `Enter` to submit and `Shift-Enter` or `Ctrl-J` for a newline.
`Ctrl-C` aborts active agent or bash work; while idle it clears non-empty input
and does nothing when input is empty. It never exits Pi. Use `Ctrl-D` to exit
when the editor is empty. Terminal, tmux, or macOS bindings own copying selected
terminal text.

| Action | Key |
|---|---|
| External editor | `Alt-E` |
| Copy last assistant message | `Alt-C` |
| Select model | `Alt-M` |
| Previous / next model | `Alt-[` / `Alt-]` |
| Cycle thinking level | `Alt-T` |
| Expand thinking / tool output | `Ctrl-T` / `Ctrl-O` |
| Follow up / dequeue | `Alt-Enter` / `Alt-Up` |

The old `Ctrl-G`, `Ctrl-X`, `Ctrl-L`, `Ctrl-P`, `Ctrl-Shift-P`, `Shift-Tab`, and
`Ctrl-C` aliases for these actions are intentionally absent.

Until Pi exposes the postponed searchable-list redesign, list-only actions use
these temporary keys:

- Session path, sort, named filter, rename, delete: `Alt-P`, `Alt-S`, `Alt-N`,
  `Alt-R`, `Alt-D`.
- Scoped-model clear and provider toggle: `Alt-X`, `Alt-P`.
- Tree filter next and previous: `Alt-F`, `Alt-Shift-F`.

The scoped-model save (`Ctrl-S`) and select-all (`Ctrl-A`) keys remain unchanged.
Session deletion retains Pi's `Enter` confirmation and `Esc` cancellation.

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
| `single` | `Up`/`k` and `Down`/`j` move, `Enter` confirm, `e` edit note |
| `multi` | `Up`/`k` and `Down`/`j` move, `Space` toggle, `Enter` confirm set, `e` edit note |
| `confirm` | `Up`/`k` and `Down`/`j` move, `Enter` confirm, `y`/`n` directly confirm, `e` edit note |
| `text` | `Enter` confirm, `Shift-Enter`/`Ctrl-J` newline |
| Note editor | `Enter` save, `Shift-Enter`/`Ctrl-J` newline, `Esc` discard |
| Review | `Up`/`k` and `Down`/`j` rows, `Tab`/`Shift-Tab` question rows, `Enter` activate, `Esc` reopen last question |

`e` never changes the current selection. After saving, the first non-empty note
line is shown beside its answer or option without reopening the editor. `Esc`
from an initial question does not cancel the call and displays the `Ctrl-C`
instruction. Text and note editor focus is propagated for IME cursor
positioning. Status, selection, errors, notes, answered/unanswered counts, and
Submit availability are shown in text as well as color.

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

## Development

```sh
cd modules/programs/pi-coding-agent
nix develop ../../.. --command npm run check
```

For a TUI smoke test:

```sh
nix develop ../../.. --command npx pi \
  --extension ./extensions/interaction_policy.ts \
  --extension ./extensions/question.ts
```

New files must be git-tracked before flake evaluation because flakes cannot read
untracked files. Manually verify Ghostty and tmux `Alt-[`/`Alt-]`, normal-input
`Ctrl-C`, Japanese IME cursor placement, multiline editing, reverse navigation,
review revision, and `/reload` help updates.
