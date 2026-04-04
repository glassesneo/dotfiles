# modules/services/kanata/

This subtree owns the local Kanata configuration and its darwin/home-manager wiring.
Prefer this file over parent guidance for Kanata-specific changes.

## Files

- `default.nix`: Nix wiring for the Kanata service, config file deployment, and Kanata Bar integration.
- `kanata.kbd`: The actual Kanata keymap/configuration. Most behavior changes happen here.

## How To Validate

- Syntax-check the Kanata config before proposing activation:

```bash
kanata --cfg modules/services/kanata/kanata.kbd --check
```

- If you add a new file under this subtree and expect Nix to see it, remember that flakes only read git-tracked files.

## Primary Sources

Start with the official Kanata config guide. Prefer the versioned doc that matches the installed binary when behavior is ambiguous.

- Current main guide:
  `https://github.com/jtroo/kanata/blob/main/docs/config.adoc`
- Versioned guide pattern:
  `https://github.com/jtroo/kanata/blob/v<version>/docs/config.adoc`
- Local installed version check:

```bash
kanata --version
```

## What To Look Up

When changing behavior in `kanata.kbd`, do not rely on memory for advanced actions. Look up the exact syntax and semantics for:

- `tap-hold-*` variants, especially `tap-hold-release-timeout`
- `switch` conditions such as `input`, `input-history`, and `key-timing`
- `deffakekeys` plus `on-press-fakekey` / `on-release-fakekey`
- `defchordsv2`, `concurrent-tap-hold`, and `chords-v2-min-idle`
- `one-shot` and `layer-while-held`

The local binary can also help confirm parser support for action names:

```bash
strings /run/current-system/sw/bin/kanata | rg 'tap-hold|one-shot|defchordsv2|fakekey|switch'
```

## Local Design Notes

- This config is optimized for practical macOS use, not for showcasing Kanata features.
- Favor implementations that keep common shortcuts reliable over more clever state machines.
- Be conservative with fake-key press/release flows. If press and release can diverge across branches, modifier-stuck failures are possible.
- For risky remaps, prefer small composable mechanisms and keep a straightforward rollback path in `kanata.kbd`.
