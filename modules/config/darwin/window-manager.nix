{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "darwin.window-manager";

  options = with delib;
    moduleOptions {
      enable = boolOption (pkgs.stdenv.isDarwin && host.guiShellFeatured);
      # Host-selected window-manager backend. Providers derive their own
      # enablement from this selector so exactly one WM is active per host.
      backend = enumOption ["aerospace" "rift"] "aerospace";
    };

  myconfig.ifEnabled = {cfg, ...}: {
    services.${cfg.backend}.enable = true;
    programs.autoraise.enable = cfg.backend == "aerospace";
  };
}
