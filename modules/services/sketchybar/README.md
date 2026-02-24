# SketchyBar Query Verification

This document is a runtime verification reference for `sketchybar --query` in this repository.
It intentionally uses raw command output examples (no `jq`, no rewritten tables) and focuses on how to verify live daemon state.

## Local Wiring to Keep in Mind

- Reload entrypoint: `modules/programs/reload_config.nix` runs `sketchybar --reload` when SketchyBar is enabled.
- Runtime config load: `modules/services/sketchybar/rc/sketchybarrc` applies bar/item config, then calls `sketchybar --update`.
- Query consumers: `modules/programs/nushell/completions/sketchybar.nu` queries `bar`, item names, `events`, and `default_menu_items`.
- Nix-time assertions: `modules/services/sketchybar/default.nix` validates layout invariants before runtime.

## Prerequisites and Compatibility

- Verify version:

```bash
sketchybar --version
```

- Recommended: `>= v2.19.6` (fixes known malformed JSON escaping in older versions).
- `--query displays` requires `>= v2.22.1`.
- `--query default_menu_items` depends on macOS Screen Recording permission.

## Runtime Verification Flow

1. Verify daemon is running before any query:

```bash
pgrep -x sketchybar
```

2. Reload config (repo entrypoint):

```bash
reload_config
```

3. Optional explicit refresh (normally already triggered by `sketchybarrc`):

```bash
sketchybar --update
```

4. Run query checks listed below.

Important: if daemon is not running, `sketchybar --query ...` can return empty output with exit code `0`; do not treat empty output as healthy.

## Query Targets (Raw JSON Examples)

These are representative payloads, not strict schemas. Actual keys and values depend on your active config.

### `bar`

```bash
sketchybar --query bar
```

```json
{
  "height": 42,
  "position": "bottom",
  "topmost": "window",
  "items": ["workspace.1", "front_app", "datetime", "battery", "cpu", "volume"]
}
```

### `<item_name>`

Discover candidate names first:

```bash
sketchybar --query bar
```

```json
{
  "items": ["workspace.1", "workspace.2", "front_app", "datetime", "battery", "cpu", "volume"]
}
```

Then query one item (for example, `workspace.1`; placeholder only):

```bash
sketchybar --query workspace.1
```

```json
{
  "name": "workspace.1",
  "type": "item",
  "geometry": {
    "position": "left"
  },
  "label": {
    "drawing": "on"
  },
  "icon": {
    "drawing": "on"
  }
}
```

### `defaults`

```bash
sketchybar --query defaults
```

```json
{
  "icon": {
    "padding_left": 10,
    "font": "Hack Nerd Font:Bold:19"
  },
  "label": {
    "padding_left": 6,
    "padding_right": 10,
    "font": "Hack Nerd Font:Regular:16"
  }
}
```

### `events`

```bash
sketchybar --query events
```

```json
{
  "aerospace_workspace_change": {
    "observers": ["workspace.1", "workspace.2"]
  },
  "front_app_switched": {
    "observers": ["front_app"]
  }
}
```

### `default_menu_items`

```bash
sketchybar --query default_menu_items
```

```json
["Control Center,Battery", "Control Center,WiFi", "Clock"]
```

### `displays`

```bash
sketchybar --query displays
```

```json
{
  "1": {
    "frame": {
      "x": 0,
      "y": 0,
      "w": 3024,
      "h": 1964
    }
  }
}
```

If your version is older than `v2.22.1`, `displays` may fail with:

```text
[!] Query: Invalid query, or item 'displays' not found
```

## Troubleshooting

### Invalid target or missing item

```bash
sketchybar --query not_a_real_target
```

```text
[!] Query: Invalid query, or item 'not_a_real_target' not found
```

### `default_menu_items` permission issues

Without Screen Recording permission:

```bash
sketchybar --query default_menu_items
```

```text
Screen Recording Permissions not given.
```

With permission granted, some environments can still return empty output. Treat persistent empty output as a runtime issue and re-check daemon state and macOS permission assignment.

### Daemon not running (silent failure pattern)

- Symptom: query prints nothing, stderr is empty, and exit code is `0`.
- Guard: always run daemon precheck (`pgrep -x sketchybar`) before evaluating query results.

## Nix Checks vs Runtime Checks

Use both layers; they validate different things.

- Nix-time checks (structure and assertions):

```bash
nix flake check
```

```bash
nh home switch --dry
```

```bash
nh darwin switch . -H kurogane -Lt --dry
```

- Runtime checks (live daemon state and query payloads):

```bash
sketchybar --query bar
```

`nix flake check` and dry-run switches can catch module assertion failures from `modules/services/sketchybar/default.nix` (for example, duplicate layout priorities or item names), but they do not prove live daemon health or query payload correctness.
