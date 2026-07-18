# Pi Coding Agent integration

This module registers project-owned extensions and prompts with Pi through Home
Manager. Deterministic extension behavior lives in `extensions/`; resource
registration lives in `default.nix`.

## `question` tool

The `question` tool lets the model request decisions or missing information
needed to continue the current task. A call contains one or more questions. The
TUI keeps the whole call in one tabbed screen; RPC asks sequentially and then
opens a review loop. Both return only after explicit submission, cancellation,
or an unavailable-UI result.

Question kinds:

- `single`: choose one of at least two options.
- `multi`: choose one or more of at least two options.
- `text`: enter non-blank multiline text.
- `confirm`: choose Yes or No without conflating No with cancellation.

Every `single`, `multi`, and `confirm` selection supports an optional note.
Blank notes are omitted. A `multi` result is normalized to option definition
order, regardless of the order in which options were selected.

### Input example

```json
{
  "questions": [
    {
      "id": "scope",
      "prompt": "Which implementation scope should be used?",
      "kind": "single",
      "options": [
        {
          "value": "minimal",
          "label": "Minimal",
          "description": "Change only the current module"
        },
        {
          "value": "broad",
          "label": "Broad",
          "description": "Update related modules too"
        }
      ],
      "notePlaceholder": "Optional constraints"
    },
    {
      "id": "details",
      "prompt": "Describe any additional requirements.",
      "kind": "text",
      "initialValue": ""
    }
  ]
}
```

Question IDs must be non-blank and unique within the call. Option values and
rendered option text must be unique within each question. `text` and `confirm`
do not accept `options`; `initialValue` is text-only, and `notePlaceholder` is
selection-only. Contract violations are tool errors rather than cancellations.

### Result format

`details` and the JSON text in `content` represent the same payload:

```json
{
  "status": "answered",
  "answers": {
    "scope": {
      "kind": "single",
      "value": "minimal",
      "note": "Keep public behavior unchanged"
    },
    "details": {
      "kind": "text",
      "value": "Preserve existing tests.\nAdd adapter coverage."
    }
  }
}
```

The status is `answered`, `cancelled`, or `unavailable`. Cancellation from a
question tab preserves confirmed answers and includes that tab's
`currentQuestionId`. Cancellation from final review preserves all confirmed
answers and omits `currentQuestionId`. Non-interactive modes return:

```json
{
  "status": "unavailable",
  "answers": {}
}
```

### TUI controls

| State | Keys | Action |
|---|---|---|
| Any state | `Ctrl-C` | Cancel the whole tool call |
| Question or review | `Esc` | Cancel the whole tool call |
| Choice or text tab-navigation | `←` / `→` | Move between question tabs, wrapping at each end |
| Choices | `↑` / `↓`, `Ctrl-P` / `Ctrl-N` | Move focus |
| `single` | `Enter` | Confirm the focused option and advance |
| `multi` | `Space` | Toggle the focused option |
| `multi` | `Enter` | Confirm one or more selected options and advance |
| `confirm` | `Y` / `N` | Focus Yes or No |
| `confirm` | `Enter` | Confirm Yes or No and advance |
| Any choice | `Tab` | Select it and open its optional note |
| Note editor | `Enter` | Insert a newline |
| Note editor | `Tab` | Save the note and return to choices |
| Note editor | `Esc` | Discard the current edit and return |
| Text editor | `Enter` | Insert a newline |
| Text editor | `Tab` | Keep the draft and enter tab-navigation mode |
| Text tab-navigation | `Tab` | Return to the text editor |
| Text question | `Ctrl-D` | Confirm a non-blank answer and advance |
| Final review | `←` | Return to the last question |
| Final review | `Enter` | Submit all answers |

The top row shows every `Qn` tab, answered/unanswered state, current position,
and whether `Confirm` is locked or ready. Confirmed answers and unconfirmed
drafts survive navigation; confirming a revised answer overwrites its prior
value. Focus, selection, saved-note, validation, and submission states are shown
in text, not only with color. The component wraps or truncates every line to the
available terminal width.

### RPC fallback and mode differences

RPC uses Pi's standard extension dialogs instead of the TUI custom component:

- `single` and `confirm` use a selector followed by a multiline optional-note
  editor.
- `multi` repeatedly toggles items in a selector, uses a dedicated Done item,
  then opens a multiline note editor for each selected item.
- `text` uses the standard multiline editor.
- After the initial sequence, a review selector lists every current answer plus
  `Submit answers` and `Cancel`. Choosing a question reopens it with its current
  selection, text, and notes; the replacement answer returns to review.

RPC reproduces the TUI review, revision, and explicit-submission semantics, not
its exact keys or tab layout. Standard dialogs that support `AbortSignal`
receive it directly. The standard editor has no signal option in Pi 0.80.7, so
interruption is checked before and after it; returning the cancelled result can
wait for the RPC client to close that editor.

Print and JSON modes do not open dialogs and return `unavailable`.

## Development

Run checks from this directory through the repository's Nix development shell:

```sh
nix develop --command npm ci
nix develop --command npm run check
```

To load the extension directly for a TUI smoke test:

```sh
nix develop --command npx pi --extension ./extensions/question.ts
```

New extension files must be git-tracked before flake evaluation because flakes
cannot read untracked files.
