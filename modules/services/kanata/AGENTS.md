# modules/services/kanata/

## Ownership Boundaries

- The Nix module owns service wiring, declarative injection selection, and generation of the root Kanata config.
- The common keyboard layer owns Rift-independent aliases, fakekeys, and chord definitions shared by profiles.
- Profiles own the canonical superset `defsrc` plus the first-defined `base` layer for each keyboard profile.
- Injections own sparse overlay behavior, injection-specific aliases, extra layers, and command bindings.

## Invariants

- Keep the sole `defcfg` and all `include` directives in the generated root; included files cannot include other files.
- Keep each profile's canonical `base` first and its `defsrc` a stable superset. Sparse overlays rely on `delegate-to-first-layer`.
- Do not duplicate `defalias`, `defsrc`, or `deflayer`, and do not redefine `defsrc` in injection fragments.
- Treat fake-key press/release branches conservatively because divergent paths can leave modifiers stuck.
- Model injection-specific defaults as sparse startup-selected overlays, not full profile replacements.

## Validation

Build the generated root configuration and syntax-check that generated file before activation. Consult the Kanata documentation matching the installed version when advanced action semantics are ambiguous.
