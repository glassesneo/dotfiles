{
  delib,
  host,
  ...
}:
delib.module {
  name = "services.windowManagement";

  options = with delib;
    moduleOptions {
      enable = boolOption host.windowManagementFeatured;
      # Host-selected window-manager backend. Providers derive their own
      # enablement from this selector so exactly one WM is active per host.
      backend = enumOption ["aerospace" "rift"] "aerospace";
    };

  myconfig.ifEnabled = {cfg, ...}: {
    programs.autoraise.enable = cfg.backend == "aerospace";
  };
}
