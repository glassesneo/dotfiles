{
  delib,
  host,
  lib,
  pkgs,
  config,
  ...
}:
delib.module {
  name = "darwin.window-manager";

  options = with delib;
    moduleOptions {
      enable = boolOption (pkgs.stdenv.isDarwin && host.guiShellFeatured);
      # Host-selected window-manager backend. Providers derive their own
      # read-only enablement from this selector so exactly one WM is active per host.
      backend = enumOption ["aerospace" "rift"] "aerospace";
    };

  myconfig.always.args.shared.windowManager = let
    wm = config.myconfig.darwin.window-manager;
  in {
    inherit (wm) enable backend;
    isAerospace = wm.enable && wm.backend == "aerospace";
    isRift = wm.enable && wm.backend == "rift";
    aerospace.executable = lib.getExe pkgs.aerospace;
    rift = {
      executable = lib.getExe config.myconfig.services.rift.package;
      cli = "${config.myconfig.services.rift.package}/bin/rift-cli";
    };
  };

  darwin.always.assertions = [
    {
      assertion = let
        wm = config.myconfig.darwin.window-manager;
      in
        (!wm.enable)
        || ((config.myconfig.services.aerospace.enable != config.myconfig.services.rift.enable)
          && (config.myconfig.services.aerospace.enable == (wm.backend == "aerospace"))
          && (config.myconfig.services.rift.enable == (wm.backend == "rift")));
      message = "darwin.window-manager.backend must be the only active WM provider selector.";
    }
  ];

  myconfig.ifEnabled = {cfg, ...}: {
    programs.autoraise.enable = cfg.backend == "aerospace";
  };
}
