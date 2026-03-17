{
  delib,
  lib,
  ...
}:
delib.module {
  name = "nix-darwin.system.ime";

  options.nix-darwin.system.ime = with delib; {
    enable = boolOption true;

    # Central aggregation interface for com.apple.HIToolbox input-source arrays.
    # Feature modules (e.g. AquaSKK) contribute entries here; this module is the
    # sole final writer so ordering and deduplication are controlled in one place.
    extraEnabledInputSources = listOfOption lib.types.attrs [];
    extraSelectedInputSources = listOfOption lib.types.attrs [];
    extraInputSourceHistory = listOfOption lib.types.attrs [];
  };

  darwin.ifEnabled = {cfg, ...}: let
    # Shared system input sources — always present regardless of feature modules.
    baseEnabled = [
      {
        "Bundle ID" = "com.apple.CharacterPaletteIM";
        InputSourceKind = "Non Keyboard Input Method";
      }
      {
        "Bundle ID" = "com.apple.PressAndHold";
        InputSourceKind = "Non Keyboard Input Method";
      }
      {
        InputSourceKind = "Keyboard Layout";
        "KeyboardLayout ID" = 252;
        "KeyboardLayout Name" = "ABC";
      }
      {
        "Bundle ID" = "com.apple.50onPaletteIM";
        InputSourceKind = "Non Keyboard Input Method";
      }
    ];

    baseSelected = [
      {
        "Bundle ID" = "com.apple.PressAndHold";
        InputSourceKind = "Non Keyboard Input Method";
      }
    ];

    baseHistory = [
      {
        InputSourceKind = "Keyboard Layout";
        "KeyboardLayout ID" = 252;
        "KeyboardLayout Name" = "ABC";
      }
    ];
  in {
    system = {
      defaults = {
        CustomUserPreferences."com.apple.HIToolbox" = {
          AppleGlobalTextInputProperties = {
            TextInputGlobalPropertyPerContextInput = true; # Keep input method state per application
          };

          # Feature-contributed entries appear after the base entries, preserving
          # the same ordering as the pre-refactor hardcoded lists.
          AppleEnabledInputSources = baseEnabled ++ cfg.extraEnabledInputSources;
          AppleSelectedInputSources = baseSelected ++ cfg.extraSelectedInputSources;
          AppleInputSourceHistory = cfg.extraInputSourceHistory ++ baseHistory;
        };
      };
    };
  };
}
