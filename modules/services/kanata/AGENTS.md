# modules/services/kanata/

## Ownership Boundaries

- The Nix module owns service wiring, the typed integration contribution interface, and generation of the root Kanata config.
- The common keyboard layer owns consumer-independent aliases, fakekeys, and chord definitions shared by profiles.
- Profiles own the canonical superset `defsrc` plus the first-defined `base` layer for each keyboard profile.
- External-software owners contribute their own sparse overlays, integration aliases, and extra layers through `myconfig.services.kanata.integrations`.

## Invariants

- Keep the sole `defcfg` and all `include` directives in the generated root; included files cannot include other files.
- Keep each profile's canonical `base` first and its `defsrc` a stable superset. Sparse integration overlays rely on `delegate-to-first-layer`.
- Assemble enabled integration fragments in deterministic name order, and reject distinct non-null startup base layers.
- Do not duplicate `defalias`, `defsrc`, or `deflayer`, and do not redefine `defsrc` in integration fragments.
- Treat fake-key press/release branches conservatively because divergent paths can leave modifiers stuck.
- Model integration-specific defaults as sparse startup-selected overlays, not full profile replacements.

## Validation

Build the generated root configuration and syntax-check that generated file before activation. Consult the Kanata documentation matching the installed version when advanced action semantics are ambiguous.
