{
  applicationLauncher,
  delib,
  inputs,
  pkgs,
  ...
}:
delib.module {
  name = "programs.vicinae";

  options = with delib;
    moduleOptions {
      # Activation is derived from the shared application-launcher selector.
      enable = readOnly (boolOption applicationLauncher.isVicinae);
    };

  home.always.imports = [inputs.vicinae.homeManagerModules.default];

  home.ifEnabled = {
    programs.vicinae = {
      enable = true;
      launchd.enable = pkgs.stdenv.isDarwin;
      settings.global_shortcuts.toggle = "control+space";
    };
  };
}
