{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.pure-prompt";

  options = with delib;
    moduleOptions ({myconfig, ...}: {
      enable = boolOption (host.devCoreFeatured && myconfig.programs.zsh.enable);
    });

  home.ifEnabled = {
    programs.zsh = {
      initContent = builtins.readFile ./init.zsh;
    };

    home.packages = [pkgs.pure-prompt];
  };
}
