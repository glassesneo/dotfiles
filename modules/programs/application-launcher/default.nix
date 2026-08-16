{
  config,
  delib,
  homeConfig,
  host,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.application-launcher";

  options = with delib;
    moduleOptions {
      enable = boolOption (pkgs.stdenv.isDarwin && host.guiShellFeatured);
      # Rice-selected launcher backend. Providers derive their read-only
      # enablement from this selector so only one owns the global launcher role.
      backend = enumOption ["raycast" "vicinae"] "raycast";
    };

  myconfig.always.args.shared.applicationLauncher = let
    launcher = config.myconfig.programs.application-launcher;
  in {
    inherit (launcher) enable backend;
    isRaycast = launcher.enable && launcher.backend == "raycast";
    isVicinae = launcher.enable && launcher.backend == "vicinae";
  };

  home.always.assertions = [
    {
      assertion = let
        launcher = config.myconfig.programs.application-launcher;
      in
        (!launcher.enable)
        || ((config.myconfig.programs.raycast.enable != config.myconfig.programs.vicinae.enable)
          && (config.myconfig.programs.raycast.enable == (launcher.backend == "raycast"))
          && (config.myconfig.programs.vicinae.enable == (launcher.backend == "vicinae")));
      message = "programs.application-launcher.backend must be the only active launcher provider selector.";
    }
  ];

  home.ifEnabled = {cfg, ...}: {
    # Raycast is opened as an application rather than kept alive by launchd, so
    # removing its agent does not stop an existing process during a backend switch.
    home.activation.applicationLauncherStopInactiveRaycast = lib.mkIf (cfg.backend == "vicinae") (
      homeConfig.lib.dag.entryBefore ["setupLaunchAgents"] (builtins.readFile ./quit-raycast.sh)
    );
  };

  darwin.ifEnabled = {
    # Both providers use ⌘Space, so this owner releases the shared system hotkey.
    system.defaults.CustomUserPreferences."com.apple.symbolichotkeys".AppleSymbolicHotKeys."64" = {
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
}
