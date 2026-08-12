{
  delib,
  host,
  lib,
  pkgs,
  wrappers,
  ...
}:
delib.module {
  name = "programs.bat";

  options = with delib;
    moduleOptions ({myconfig, ...}: {
      enable = boolOption host.devCoreFeatured;
      theme = strOption (
        if myconfig.args.shared.colorscheme.name == "catppuccin"
        then "Catppuccin ${lib.toSentenceCase myconfig.args.shared.colorscheme.variant}"
        else "ansi"
      );
    });

  home.ifEnabled = {cfg, ...}: let
    configFile = pkgs.writeText "bat.conf" ''
      ${builtins.readFile ./bat.conf}
      --theme=${lib.escapeShellArg cfg.theme}
    '';
    package = wrappers.bat {
      inherit configFile;
    };
    extraPackages = with pkgs.bat-extras; [
      batdiff
      prettybat
    ];
  in {
    home.packages = [package] ++ extraPackages;
  };
}
