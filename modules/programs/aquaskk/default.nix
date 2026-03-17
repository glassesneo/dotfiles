{
  brewCasks,
  delib,
  host,
  inputs,
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
    home.activation.aquaskkSetup = inputs.home-manager.lib.hm.dag.entryAfter ["linkGeneration"] ''
      _aquaskk_plist="$HOME/Library/Preferences/jp.sourceforge.inputmethod.aquaskk.plist"
      _aquaskk_domain="jp.sourceforge.inputmethod.aquaskk"

      # Create user dictionary parent directory before AquaSKK first use
      $DRY_RUN_CMD mkdir -p "${userDictDir}"

      # --- AquaSKK preference seeding ---
      if [ -L "$_aquaskk_plist" ]; then
        # A symlink still exists after linkGeneration — this is non-legacy
        # protected state (e.g. manually placed or from another manager).
        # Preserve it and warn the user.
        echo "WARNING: $_aquaskk_plist is a symlink after linkGeneration."
        echo "AquaSKK preferences cannot be seeded while a symlink is in place."
        echo "To fix: remove or back up the symlink, then re-run activation."
        echo "  rm \"$_aquaskk_plist\""
        echo "  nh home switch"
      elif [ -n "$DRY_RUN_CMD" ]; then
        $VERBOSE_ECHO "Dry run: would seed AquaSKK preferences via defaults write"
      else
        # Seed startup-safe keys into the AquaSKK domain.
        # Uses additive writes so unrelated user/UI-managed settings persist.
        $VERBOSE_ECHO "Seeding AquaSKK preferences into $_aquaskk_domain..."
        /usr/bin/defaults write "$_aquaskk_domain" user_dictionary_path -string "${toString aquaskkPrefs.user_dictionary_path}"
        /usr/bin/defaults write "$_aquaskk_domain" keyboard_layout -string "${aquaskkPrefs.keyboard_layout}"
        /usr/bin/defaults write "$_aquaskk_domain" enable_skkserv -int ${toString aquaskkPrefs.enable_skkserv}
        /usr/bin/defaults write "$_aquaskk_domain" skkserv_port -int ${toString aquaskkPrefs.skkserv_port}
        /usr/bin/defaults write "$_aquaskk_domain" skkserv_localonly -int ${toString aquaskkPrefs.skkserv_localonly}
        /usr/bin/defaults write "$_aquaskk_domain" suppress_newline_on_commit -int ${toString aquaskkPrefs.suppress_newline_on_commit}
        /usr/bin/defaults write "$_aquaskk_domain" fix_intermediate_conversion -int ${toString aquaskkPrefs.fix_intermediate_conversion}
        /usr/bin/defaults write "$_aquaskk_domain" use_numeric_conversion -int ${toString aquaskkPrefs.use_numeric_conversion}
        /usr/bin/defaults write "$_aquaskk_domain" show_input_mode_icon -int ${toString aquaskkPrefs.show_input_mode_icon}
        /usr/bin/defaults write "$_aquaskk_domain" delete_okuri_when_quit -int ${toString aquaskkPrefs.delete_okuri_when_quit}
        /usr/bin/defaults write "$_aquaskk_domain" enable_annotation -int ${toString aquaskkPrefs.enable_annotation}
        /usr/bin/defaults write "$_aquaskk_domain" enable_dynamic_completion -int ${toString aquaskkPrefs.enable_dynamic_completion}
        /usr/bin/defaults write "$_aquaskk_domain" enable_extended_completion -int ${toString aquaskkPrefs.enable_extended_completion}
        /usr/bin/defaults write "$_aquaskk_domain" dynamic_completion_range -int ${toString aquaskkPrefs.dynamic_completion_range}
        /usr/bin/defaults write "$_aquaskk_domain" max_count_of_inline_candidates -int ${toString aquaskkPrefs.max_count_of_inline_candidates}
        /usr/bin/defaults write "$_aquaskk_domain" candidate_window_font_name -string "${aquaskkPrefs.candidate_window_font_name}"
        /usr/bin/defaults write "$_aquaskk_domain" candidate_window_font_size -int ${toString aquaskkPrefs.candidate_window_font_size}
        /usr/bin/defaults write "$_aquaskk_domain" candidate_window_labels -string "${aquaskkPrefs.candidate_window_labels}"
        /usr/bin/defaults write "$_aquaskk_domain" put_candidate_window_upward -int ${toString aquaskkPrefs.put_candidate_window_upward}
        /usr/bin/defaults write "$_aquaskk_domain" use_individual_input_mode -int ${toString aquaskkPrefs.use_individual_input_mode}
        /usr/bin/defaults write "$_aquaskk_domain" direct_clients -array ${lib.concatMapStringsSep " " (c: ''-string "${c}"'') aquaskkPrefs.direct_clients}

        # Verify the domain is readable by CFPreferences
        if /usr/bin/defaults read "$_aquaskk_domain" user_dictionary_path >/dev/null 2>&1; then
          $VERBOSE_ECHO "AquaSKK preferences domain is readable."
        else
          echo "WARNING: defaults read failed for $_aquaskk_domain after seeding."
          echo "AquaSKK may not start correctly. Try: defaults read $_aquaskk_domain"
        fi
      fi

    '';
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
