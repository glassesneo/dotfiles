# SketchyBar Query Verification

This document is a runtime verification reference for `sketchybar --query` in this repository.
It intentionally uses raw command output examples (no `jq`, no rewritten tables) and focuses on how to verify live daemon state.

## Architecture: Floating Island Composition

The bar uses a **floating island** model instead of a full-width strip:

- The outer SketchyBar surface is fully transparent (`0x00000000`).
- Visible surfaces come from **layout brackets** (island backgrounds) with low-alpha neutral haze (`island_surface` token, ~15% opacity).
- Islands have `corner_radius=12`, `height=28`, no border, no blur.
- Shadow is enabled on the outer bar to create floating depth.

### Host-driven layout

- **Notched hosts** (e.g. `seiran`): top bar with two islands — a left island (workspaces + front\_app) in the `left` region and a right island (datetime + battery + cpu) in the `right` region, anchored toward the screen corners.
- **Non-notched hosts** (e.g. `kurogane`): bottom bar with one centered island containing all items.

### Active workspace indicator

The active workspace renders as a standalone dot with no visible workspace number. Inactive workspaces continue to render as numeric labels. The focused dot uses the more vivid `workspace_active` token instead of the subtler `active_indicator` accent.

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
  "height": 32,
  "position": "bottom",
  "topmost": "window",
  "shadow": "on",
  "margin": 8,
  "color": "0x00000000",
  "items": ["workspace.1", "front_app", "datetime", "battery", "cpu"]
}
```

Note: `position` is host-dependent. Notched hosts (e.g. `seiran`) default to `"top"`; non-notched hosts (e.g. `kurogane`) default to `"bottom"`. Verify against the active host.

### `<item_name>`

Discover candidate names first:

```bash
sketchybar --query bar
```

Then query one item (for example, `workspace.1`; placeholder only):

```bash
sketchybar --query workspace.1
```

On a non-notched host, workspace items should show `position: "center"`:
```json
{
  "name": "workspace.1",
  "type": "item",
  "geometry": {
    "position": "center"
  }
}
```

On a notched host, workspace items should show `position: "left"`:
```json
{
  "name": "workspace.1",
  "type": "item",
  "geometry": {
    "position": "left"
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
    "padding_left": 6,
    "font": "Hack Nerd Font:Bold:17"
  },
  "label": {
    "padding_left": 4,
    "padding_right": 6,
    "font": "Hack Nerd Font:Regular:14"
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

## Visual Verification Checklist

After reloading, verify the floating island appearance:

- [ ] Outer bar reads as transparent (no full-width opaque band).
- [ ] On notched host: two islands appear at the top-left and top-right corners.
- [ ] On non-notched host: one centered island appears at the bottom.
- [ ] Island surfaces show a subtle neutral haze (low-alpha background).
- [ ] No visible borders or blur on islands.
- [ ] Shadow gives soft floating depth without heaviness.
- [ ] Active workspace renders as a standalone vivid dot with no visible workspace number.
- [ ] All widgets (front app, datetime, battery, cpu) are readable and unclipped.

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

- Host-specific verification (build validation):

```bash
# Verify both hosts evaluate cleanly
nh darwin switch . -H kurogane -Lt --dry
nh darwin switch . -H seiran -Lt --dry
```

- Runtime position verification (after applying config and reloading):

```bash
# On kurogane (non-notched): expect "position": "bottom", items at "center"
# On seiran (notched): expect "position": "top", left island items at "left", right island items at "right"
sketchybar --query bar
```

`nix flake check` and dry-run switches can catch module assertion failures from `modules/services/sketchybar/default.nix` (for example, duplicate layout priorities or item names), but they do not prove live daemon health or query payload correctness.
