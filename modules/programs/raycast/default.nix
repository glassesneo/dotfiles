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
    launchd.agents."raycast" = {
      enable = true;
      config = {
        Label = "com.${host.name}.raycast";
        ProgramArguments = [
          "/usr/bin/open"
          "-a"
          "${pkgs.raycast}/Applications/Raycast.app"
        ];
      };
    };
  };

  darwin.ifEnabled = {
    # Start at login
    launchd.agents."raycast" = {
      script = "/usr/bin/open -a ${pkgs.raycast}/Applications/Raycast.app";
      serviceConfig = {
        Label = "com.${host.name}.raycast";
        RunAtLoad = true;
      };
    };

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
