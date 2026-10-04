{
  delib,
  lib,
  mylib,
  ...
}:
delib.module {
  name = "zsh.interactive";
  meta.description = "Build Zsh's interactive environment.";

  options.enable = delib.boolOption true;

  hjem.always.options.zsh.zshrc = mylib.fragments.option;

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: let
    dotDir = "${config.xdg.config.directory}/zsh";
    fsh = pkgs.zsh-fast-syntax-highlighting;
    fshWorkDir = "${config.xdg.data.directory}/fsh";
  in {
    zsh.zshenv.zdotdir.text = ''
      ZDOTDIR="${dotDir}"
    '';

    zsh.zshrc = {
      compinit.text = ''
        autoload -Uz compinit && compinit
      '';
      pure.text = ''
        fpath+=(${pkgs.pure-prompt}/share/zsh/site-functions)
        autoload -Uz promptinit && promptinit
        prompt pure
      '';
    };

    files.".zshrc" = {
      relativeTo = dotDir;
      exclusive = true;
      text = lib.concatStringsSep "\n" [
        (builtins.readFile ./rc.zsh)
        (mylib.fragments.render config.zsh.zshrc)
        # fsh wraps the widgets that exist when it loads, so it stays last.
        ''
          FAST_WORK_DIR="${fshWorkDir}"
          source ${fsh}/share/zsh/plugins/fast-syntax-highlighting/fast-syntax-highlighting.plugin.zsh
        ''
      ];
    };

    # Without secondary_theme.zsh, fsh downloads the upstream free theme at startup.
    xdg.data.files."fsh/secondary_theme.zsh".source = "${fsh.src}/share/free_theme.zsh";
  };
}
