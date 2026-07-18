# Pi Coding Agent integration

This module registers project-owned extensions and prompts with Pi through Home
Manager. Deterministic extension behavior lives in `extensions/`; resource
registration lives in `default.nix`.

## `question` tool

The `question` tool lets the model request decisions or missing information
needed to continue the current task. A call contains one or more questions. Pi
presents them sequentially and returns only after the last answer, cancellation,
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

The status is `answered`, `cancelled`, or `unavailable`. Cancellation preserves
only previously confirmed answers and includes the unconfirmed
`currentQuestionId`. Non-interactive modes return:

```json
{
  "status": "unavailable",
  "answers": {}
}
```

### TUI controls

| State | Keys | Action |
|---|---|---|
| Any question | `Ctrl-C` | Cancel the whole tool call |
| Question screen | `Esc` | Cancel the whole tool call |
| Choices | `↑` / `↓`, `Ctrl-P` / `Ctrl-N` | Move focus |
| `single` | `Enter` | Confirm the focused option |
| `multi` | `Space` | Toggle the focused option |
| `multi` | `Enter` | Confirm one or more selected options |
| `confirm` | `Y` / `N` | Focus Yes or No |
| `confirm` | `Enter` | Confirm Yes or No |
| Any choice | `Tab` | Select it and open its optional note |
| Note editor | `Enter` | Save the note and return to choices |
| Note editor | `Esc` | Discard the current edit and return |
| `text` | `Enter` | Insert a newline |
| `text` | `Ctrl-D` | Confirm a non-blank answer |

Focus, selection, saved-note, validation, and progress states are shown in text,
not only with color. The component wraps or truncates output to the available
terminal width.

### RPC fallback and mode differences

RPC uses Pi's standard extension dialogs instead of the TUI custom component:

- `single` and `confirm` use a selector followed by an optional note input.
- `multi` repeatedly toggles items in a selector, uses a dedicated Done item,
  then asks for an optional note for each selected item.
- `text` uses the standard multiline editor.

RPC reproduces the TUI answer structure, not its exact keys or screen layout.
Standard dialogs that support `AbortSignal` receive it directly. The standard
editor has no signal option in Pi 0.80.7, so interruption is checked before and
after it; returning the cancelled result can wait for the RPC client to close
that editor.

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
