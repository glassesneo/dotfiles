# modules/config/

## Shared Data Ownership

- `constants.nix` owns user metadata; consume its exported constants instead of repeating literals.
- `colorschemes/` owns palette data, symbolic selector validation, and export of the resolved identity and palette. Keep palettes as pure color/polarity data; feature owners map the selected shared colorscheme to their own upstream configuration.
- `wallpaper/` owns the symbolic wallpaper registry and resolves selections for the desktoppr feature. Rices and consumers must not pass concrete wallpaper paths around this boundary.
- `host-tier.nix` exports the shared `tiers` helper for ordered comparisons; `docs/host-tiers.md` owns the tier semantics.

## Local Decision Rules

- Editor modules own their concrete keymaps. Add a shared keymap contract only when a genuine cross-editor abstraction is simpler than editor-local definitions.
