{
  applicationLauncher,
  copiedDarwinApps,
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

  home.ifEnabled = let
    raycastApp = copiedDarwinApps.path "Raycast";
  in {
    home.packages = [
      pkgs.raycast
    ];

    home.activation.raycastPruneStaleInstances = homeConfig.lib.dag.entryAfter ["copyApps"] (
      builtins.readFile (pkgs.replaceVars ./activation.sh {
        currentRaycastExe = lib.escapeShellArg "${raycastApp}/Contents/MacOS/Raycast";
        currentRaycastPrefix = lib.escapeShellArg "${raycastApp}/Contents/";
        currentRaycastApp = lib.escapeShellArg raycastApp;
      })
    );

    launchd.agents."raycast" = {
      enable = true;
      config = {
        Label = "com.${host.name}.raycast";
        ProgramArguments = [
          "/usr/bin/open"
          "-g"
          "-a"
          raycastApp
        ];
        RunAtLoad = true;
      };
    };

    targets.darwin.defaults."com.raycast.macos" = {
      raycastGlobalHotkey = "Command-49"; # ⌘Space
      raycastShouldFollowSystemAppearance = true;
      onboardingCompleted = true;
      useHyperKeyIcon = true;
      raycastPreferredWindowMode = "compact";
      "raycastUI_preferredTextSize" = "medium";
    };
  };
}
