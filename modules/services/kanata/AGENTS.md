# modules/services/kanata/

This subtree owns the local Kanata configuration and its darwin/home-manager wiring.
Prefer this file over parent guidance for Kanata-specific changes.

## Ownership Boundaries

- The Nix module owns service wiring, declarative injection selection, and generation of the root Kanata config.
- The common keyboard layer owns Rift-independent aliases, fakekeys, and chord definitions shared by profiles.
- Profiles own the canonical superset `defsrc` plus the first-defined `base` layer for each keyboard profile.
- Injections own sparse overlay behavior, injection-specific aliases, extra layers, and command bindings.

## How To Validate

- Build the generated Kanata config path, then syntax-check that generated file before proposing activation.

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
- `deflayermap`, `use-defsrc`, and transparent-key resolution
- `defchordsv2`, `concurrent-tap-hold`, and `chords-v2-min-idle`
- `one-shot`, `layer-switch`, `layer-while-held`, and `alias-to-trigger-on-load`

The local binary can also help confirm parser support for action names:

```bash
strings /run/current-system/sw/bin/kanata | rg 'tap-hold|one-shot|defchordsv2|fakekey|switch'
```

## Local Design Notes

- This config is optimized for practical macOS use, not for showcasing Kanata features.
- Favor implementations that keep common shortcuts reliable over more clever state machines.
- Be conservative with fake-key press/release flows. If press and release can diverge across branches, modifier-stuck failures are possible.
- Keep `defcfg` only in the generated root config. Kanata allows only a single `defcfg`.
- Keep `include` only at the generated root level. Included files cannot themselves include other files.
- Keep the canonical profile `base` as the first defined layer. Sparse injection overlays rely on `delegate-to-first-layer` to inherit it.
- Keep profile `defsrc` as a stable superset of keys used by global remaps and active injections.
- Duplicate `defalias`, `defsrc`, and `deflayer` definitions are invalid. Do not redefine `defsrc` from injection fragments.
- If an injection needs different default behavior, model that as a sparse startup-selected overlay base layer in `injections/<name>.kbd`, not a full profile replacement.
- For risky remaps, prefer small composable mechanisms and keep a straightforward rollback path in the active profile fragment.
