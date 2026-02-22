{
  brewCasks,
  delib,
  homeConfig,
  host,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.aquaskk";

  options = delib.singleEnableOption (pkgs.stdenv.isDarwin && host.guiShellFeatured);

  home.ifEnabled.home.file = let
    homeDir = homeConfig.home.homeDirectory;
    mkDict = name: sourcePkg: {
      inherit name;
      source = "${sourcePkg}/share/skk/${name}";
    };
    largeJISYO = mkDict "SKK-JISYO.L" pkgs.skkDictionaries.l;
    dictionaries = [
      largeJISYO
    ];
    dictionaryFiles =
      dictionaries
      |> map (jisyo: {
        name = "Library/Application Support/AquaSKK/${jisyo.name}";
        value.source = jisyo.source;
      })
      |> builtins.listToAttrs;
    dictionarySet =
      dictionaries
      |> map (jisyo: {
        active = true;
        location = "${homeDir}/Library/Application Support/AquaSKK/${jisyo.name}";
        type = 0;
      });
  in
    {
      # Symlink AquaSKK.app to ~/Library/Input Methods/ for macOS discovery
      "Library/Input Methods/AquaSKK.app" = {
        source = "${brewCasks.aquaskk}/Library/Input Methods/AquaSKK.app";
      };

      # "Library/Application Support/AquaSKK/SKK-JISYO.L" = {
      # source = "${pkgs.skkDictionaries.l}/share/skk/SKK-JISYO.L";
      # };

      # AquaSKK keymap configuration (uses tabs as separators, required by AquaSKK parser)
      "Library/Application Support/AquaSKK/keymap.conf" = {
        source = ./keymap.conf;
      };

      # Kana rule (romaji-to-kana mapping, must be EUC-JP encoded)
      "Library/Application Support/AquaSKK/kana-rule.conf" = {
        source = "${brewCasks.aquaskk}/Library/Input Methods/AquaSKK.app/Contents/Resources/kana-rule.conf";
      };
      "Library/Application Support/AquaSKK/DictionarySet.plist".text = dictionarySet |> lib.generators.toPlist {escape = true;};
    }
    // dictionaryFiles;
}
