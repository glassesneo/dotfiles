# AquaSKK Operations

This is the operational guide for the AquaSKK module in this directory.

## What activation owns

`default.nix` installs AquaSKK under `~/Library/Input Methods`, manages its
keymap, EUC-JP kana rule, and dictionary set, then runs `activation.sh` after
Home Manager's `linkGeneration` phase. The activation writes startup-safe
preferences with `defaults write` to the
`jp.sourceforge.inputmethod.aquaskk` CFPreferences domain.

The preferences plist must be a real CFPreferences-managed file. A symlink into
the Nix store is not readable in the way AquaSKK expects and can cause startup
failure. Running after `linkGeneration` lets Home Manager first remove a plist
symlink left by an older managed-file definition.

## Recover from a plist symlink warning

If activation reports that
`~/Library/Preferences/jp.sourceforge.inputmethod.aquaskk.plist` is still a
symlink, it preserves the file because another manager or the user may own it.
Inspect and back it up if needed, then remove the symlink and activate again:

```sh
ls -l "$HOME/Library/Preferences/jp.sourceforge.inputmethod.aquaskk.plist"
rm "$HOME/Library/Preferences/jp.sourceforge.inputmethod.aquaskk.plist"
nh home switch
```

Do not replace it with another managed symlink. Confirm the seeded domain is
readable without editing the plist directly:

```sh
defaults read jp.sourceforge.inputmethod.aquaskk user_dictionary_path
```

## Recover input-source discovery

The AquaSKK feature contributes its enabled, selected, and history entries to
the central IME aggregation interface in
`modules/toplevel/nix-darwin/system/ime.nix`. That module is the sole writer of
the shared `com.apple.HIToolbox` arrays.

After activation, log out and back in so macOS discovers the input method. If
AquaSKK still does not appear, open **System Settings → Keyboard → Input Sources
→ Edit → Add Input Source**, search for AquaSKK, and add it. Then log out and in
once more if applications still show stale input-source state.

For implementation details, see `default.nix` and `activation.sh` in this
directory.
