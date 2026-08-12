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

  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled = {myconfig, ...}: let
    theme = "Catppuccin ${lib.toSentenceCase myconfig.theme.catppuccin.flavor}";
    configFile = pkgs.writeText "bat.conf" ''
      ${builtins.readFile ./bat.conf}
      --theme=${lib.escapeShellArg theme}
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
    catppuccin.bat.enable = false;
  };
}
