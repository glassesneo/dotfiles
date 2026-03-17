{delib, ...}:
delib.module {
  name = "nix-darwin.system.ime";

  options = delib.singleEnableOption true;

  darwin.ifEnabled = {
    system = {
      defaults = {
        CustomUserPreferences."com.apple.HIToolbox" = {
          AppleGlobalTextInputProperties = {
            TextInputGlobalPropertyPerContextInput = true; # Keep input method state per application, default is false
          };
          AppleSelectedInputSources = [
            {
              "Bundle ID" = "com.apple.PressAndHold";
              InputSourceKind = "Non Keyboard Input Method";
            }
            {
              "Bundle ID" = "jp.sourceforge.inputmethod.aquaskk";
              "Input Mode" = "com.apple.inputmethod.Japanese";
              InputSourceKind = "Input Mode";
            }
          ];

          AppleInputSourceHistory = [
            {
              "Bundle ID" = "jp.sourceforge.inputmethod.aquaskk";
              "Input Mode" = "com.apple.inputmethod.Japanese";
              InputSourceKind = "Input Mode";
            }
            {
              InputSourceKind = "Keyboard Layout";
              "KeyboardLayout ID" = 252;
              "KeyboardLayout Name" = "ABC";
            }
          ];
        };
      };
    };
  };
}
