{delib, ...}:
delib.module {
  name = "batman";
  meta.description = "Provide batman and configure it as Zsh's manual page pager.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [pkgs.bat-extras.batman];

    zsh.zshrc.batman.text = pkgs.bat-extras.batman.shellInit "zsh";
  };
}
