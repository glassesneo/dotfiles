{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.raycast";

  options = delib.singleEnableOption (pkgs.stdenv.isDarwin && host.guiShellFeatured);

  home.ifEnabled = {
    home.packages = [
      pkgs.raycast
    ];

    # Start at login
    launchd.agents."raycast" = {
      enable = true;
      config = {
        Label = "com.${host.name}.raycast";
        ProgramArguments = [
          "/usr/bin/osascript"
          "-e"
          "tell application id \"com.raycast.macos\" to launch"
        ];
        RunAtLoad = true;
      };
    };
  };

  darwin.ifEnabled = {
    system.defaults.CustomUserPreferences = {
      # Disable Spotlight hotkey so Raycast can claim ⌘Space
      "com.apple.symbolichotkeys" = {
        AppleSymbolicHotKeys = {
          "64" = {
            enabled = false;
            value = {
              type = "standard";
              parameters = [
                32
                49
                1048576
              ];
            };
          };
        };
      };

      "com.raycast.macos" = {
        raycastGlobalHotkey = "Command-49"; # ⌘Space
        raycastShouldFollowSystemAppearance = true;
        onboardingCompleted = true;
        useHyperKeyIcon = true;
        raycastPreferredWindowMode = "compact";
        "raycastUI_preferredTextSize" = "medium";
      };
    };
  };
}
