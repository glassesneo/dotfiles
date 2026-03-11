{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.zsh.fsh";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.zsh = {
      plugins = [
        {
          name = "fast-syntax-highlighting";
          src = pkgs.zsh-fast-syntax-highlighting;
          file = "share/zsh/plugins/fast-syntax-highlighting/fast-syntax-highlighting.plugin.zsh";
        }
      ];
    };
  };
}
