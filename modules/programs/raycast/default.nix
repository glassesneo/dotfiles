{
  applicationLauncher,
  delib,
  homeConfig,
  host,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.raycast";

  options = with delib;
    moduleOptions {
      # Activation is derived from the shared application-launcher selector.
      enable = readOnly (boolOption applicationLauncher.isRaycast);
    };

  home.ifEnabled = {
    home.packages = [
      pkgs.raycast
    ];

    home.activation.raycastPruneStaleInstances = homeConfig.lib.dag.entryAfter ["writeBoundary"] (
      builtins.readFile (pkgs.replaceVars ./activation.sh {
        currentRaycastExe = lib.escapeShellArg "${pkgs.raycast}/Applications/Raycast.app/Contents/MacOS/Raycast";
        currentRaycastPrefix = lib.escapeShellArg "${pkgs.raycast}/Applications/Raycast.app/Contents/";
        currentRaycastApp = lib.escapeShellArg "${pkgs.raycast}/Applications/Raycast.app";
      })
    );

    # Start at login
    launchd.agents."raycast" = {
      enable = true;
      config = {
        Label = "com.${host.name}.raycast";
        ProgramArguments = [
          "/usr/bin/open"
          "-g"
          "-a"
          "${pkgs.raycast}/Applications/Raycast.app"
        ];
        RunAtLoad = true;
      };
    };
  };

  darwin.ifEnabled = {
    system.defaults.CustomUserPreferences = {
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
