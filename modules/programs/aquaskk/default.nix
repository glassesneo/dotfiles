{
  brewCasks,
  delib,
  host,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.aquaskk";

  options = delib.singleEnableOption (pkgs.stdenv.isDarwin && host.guiShellFeatured);

  home.ifEnabled = {myconfig, ...}: let
    mkDict = name: sourcePkg: type: {
      source = "${sourcePkg}/share/skk/${name}";
      inherit type;
    };
    largeJISYO = mkDict "SKK-JISYO.L" pkgs.skkDictionaries.l 0;
    skkeletonJISYO = {
      source = myconfig.programs.nixvim.plugins.skkeleton.skkeletonUserDictPath;
      type = 5;
    };
    dictionarySet =
      map (jisyo: {
        active = true;
        location = jisyo.source;
        inherit (jisyo) type;
      }) [
        largeJISYO
        skkeletonJISYO
      ];
    kanaRuleEucJP =
      pkgs.runCommand "kana-rule.conf" {
        nativeBuildInputs = [pkgs.libiconv];
      } ''
        iconv -f UTF-8 -t EUC-JP ${./kana-rule.conf} > $out
      '';
  in {
    home.file = {
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
        source = kanaRuleEucJP;
      };
      "Library/Application Support/AquaSKK/DictionarySet.plist".text = lib.generators.toPlist {escape = true;} dictionarySet;
    };
  };
}
