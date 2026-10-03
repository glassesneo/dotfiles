{
  delib,
  lib,
  ...
}:
delib.module {
  name = "fzf";
  meta.description = "Provide fzf, configure its candidate search and display, and enable selected Zsh bindings.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: let
    fileCommand = "${lib.getExe pkgs.fd} -H -E .git --type f --strip-cwd-prefix -E .agents -E .DS_Store -E .direnv -E .envrc -E var/";
  in {
    packages = [pkgs.fzf];

    environment.sessionVariables = {
      FZF_DEFAULT_COMMAND = fileCommand;
      FZF_CTRL_T_COMMAND = fileCommand;
      FZF_ALT_C_COMMAND = "";
      FZF_DEFAULT_OPTS = lib.concatStringsSep " " [
        "--color=bg:-1,list-bg:-1,preview-bg:-1,input-bg:-1,header-bg:-1,footer-bg:-1"
        "--color=gutter:-1,border:-1"
        "--border=sharp"
        "--no-separator"
        "--no-scrollbar"
      ];
      FZF_TMUX = "1";
      FZF_TMUX_OPTS = "-p 80%,50%";
    };

    zsh.zshrc.fzf = {
      after = ["compinit"];
      text = ''
        if [[ $options[zle] = on ]]; then
          source <(${lib.getExe pkgs.fzf} --zsh)
        fi
      '';
    };
  };
}
