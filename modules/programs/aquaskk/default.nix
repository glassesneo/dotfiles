{
  brewCasks,
  delib,
  host,
  ...
}:
delib.module {
  name = "programs.aquaskk";

  options = delib.singleEnableOption host.guiShellFeatured;

  home.ifEnabled.home.file = {
    # Symlink AquaSKK.app to ~/Library/Input Methods/ for macOS discovery
    "Library/Input Methods/AquaSKK.app" = {
      source = "${brewCasks.aquaskk}/Library/Input Methods/AquaSKK.app";
    };

    # AquaSKK keymap configuration (uses tabs as separators, required by AquaSKK parser)
    "Library/Application Support/AquaSKK/keymap.conf" = {
      source = ./keymap.conf;
    };

    # Kana rule (romaji-to-kana mapping, must be EUC-JP encoded)
    "Library/Application Support/AquaSKK/kana-rule.conf" = {
      source = "${brewCasks.aquaskk}/Library/Input Methods/AquaSKK.app/Contents/Resources/kana-rule.conf";
    };
  };
}
