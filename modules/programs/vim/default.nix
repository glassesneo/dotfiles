{delib, ...}:
delib.module {
  name = "programs.vim";

  options.programs.vim = with delib; {
    enable = boolOption true;
  };

  home.ifEnabled = {
    programs.vim = {
      enable = true;

      extraConfig = ''
        ${builtins.readFile ./.vimrc}
      '';
    };
  };
}
