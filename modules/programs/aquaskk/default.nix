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

  home.ifEnabled = {myconfig, ...}: let
    mkDict = name: sourcePkg: type: {
      source = "${sourcePkg}/share/skk/${name}";
      inherit type;
    };
    largeJISYO = mkDict "SKK-JISYO.L" pkgs.skkDictionaries.l 0;
    skkeletonUserDictPath = myconfig.programs.nixvim.plugins.skkeleton.skkeletonUserDictPath;
    skkeletonJISYO = {
      source = skkeletonUserDictPath;
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

    # Startup-safe AquaSKK preferences seed. Without a preferences plist, AquaSKK
    # crashes with SIGSEGV because prepareUserDefaults reads factory defaults from
    # a hardcoded system path that doesn't exist for Nix-managed installations,
    # causing stringForKey: to return nil -> std::string(NULL) -> strlen(NULL).
    # Domain: jp.sourceforge.inputmethod.aquaskk
    aquaskkPrefs = {
      user_dictionary_path = skkeletonUserDictPath;
      keyboard_layout = "com.apple.keylayout.US";
      enable_skkserv = 1;
      skkserv_port = 1178;
      skkserv_localonly = 1;
      suppress_newline_on_commit = 1;
      fix_intermediate_conversion = 1;
      use_numeric_conversion = 1;
      show_input_mode_icon = 1;
      delete_okuri_when_quit = 1;
      enable_annotation = 1;
      enable_dynamic_completion = 1;
      enable_extended_completion = 1;
      dynamic_completion_range = 2;
      max_count_of_inline_candidates = 3;
      candidate_window_font_name = "Trebuchet MS";
      candidate_window_font_size = 18;
      candidate_window_labels = "ASDFJKL";
      put_candidate_window_upward = 1;
      use_individual_input_mode = 1;
      # Terminal apps where AquaSKK uses direct (passthrough) mode
      direct_clients = [
        "com.mitchellh.ghostty"
      ];
    };

    userDictDir = dirOf skkeletonUserDictPath;
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

      "Library/Application Support/AquaSKK/DictionarySet.plist".text =
        lib.generators.toPlist {escape = true;} dictionarySet;
    };

    # AquaSKK preferences are written at activation time via `defaults write`
    # instead of being managed as a home.file symlink. CFPreferences cannot read
    # a plist that is a symlink into /nix/store, so the old home.file approach
    # caused AquaSKK to crash with SIGSEGV on startup. This hook runs after
    # linkGeneration so that any obsolete managed symlink is already cleaned up
    # before we seed preferences into the real CFPreferences domain.
    home.activation.aquaskkSetup = homeConfig.lib.dag.entryAfter ["linkGeneration"] (
      builtins.readFile (pkgs.replaceVars ./activation.sh {
        inherit userDictDir;
        inherit
          (aquaskkPrefs)
          user_dictionary_path
          keyboard_layout
          candidate_window_font_name
          candidate_window_labels
          ;
        enable_skkserv = toString aquaskkPrefs.enable_skkserv;
        skkserv_port = toString aquaskkPrefs.skkserv_port;
        skkserv_localonly = toString aquaskkPrefs.skkserv_localonly;
        suppress_newline_on_commit = toString aquaskkPrefs.suppress_newline_on_commit;
        fix_intermediate_conversion = toString aquaskkPrefs.fix_intermediate_conversion;
        use_numeric_conversion = toString aquaskkPrefs.use_numeric_conversion;
        show_input_mode_icon = toString aquaskkPrefs.show_input_mode_icon;
        delete_okuri_when_quit = toString aquaskkPrefs.delete_okuri_when_quit;
        enable_annotation = toString aquaskkPrefs.enable_annotation;
        enable_dynamic_completion = toString aquaskkPrefs.enable_dynamic_completion;
        enable_extended_completion = toString aquaskkPrefs.enable_extended_completion;
        dynamic_completion_range = toString aquaskkPrefs.dynamic_completion_range;
        max_count_of_inline_candidates = toString aquaskkPrefs.max_count_of_inline_candidates;
        candidate_window_font_size = toString aquaskkPrefs.candidate_window_font_size;
        put_candidate_window_upward = toString aquaskkPrefs.put_candidate_window_upward;
        use_individual_input_mode = toString aquaskkPrefs.use_individual_input_mode;
        directClientsArgs = lib.concatMapStringsSep " " (c: ''-string "${c}"'') aquaskkPrefs.direct_clients;
      })
    );
  };

  # Declare AquaSKK-owned input-source entries via the central HIToolbox
  # aggregation interface in ime.nix. This replaces the former best-effort
  # activation-time `defaults write ... -array-add` registration.
  myconfig.ifEnabled.nix-darwin.system.ime = {
    extraEnabledInputSources = [
      {
        "Bundle ID" = "jp.sourceforge.inputmethod.aquaskk";
        InputSourceKind = "Keyboard Input Method";
      }
    ];
    extraSelectedInputSources = [
      {
        "Bundle ID" = "jp.sourceforge.inputmethod.aquaskk";
        "Input Mode" = "com.apple.inputmethod.Japanese";
        InputSourceKind = "Input Mode";
      }
    ];
    extraInputSourceHistory = [
      {
        "Bundle ID" = "jp.sourceforge.inputmethod.aquaskk";
        "Input Mode" = "com.apple.inputmethod.Japanese";
        InputSourceKind = "Input Mode";
      }
    ];
  };
}
