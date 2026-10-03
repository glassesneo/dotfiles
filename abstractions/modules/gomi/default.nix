{delib, ...}:
delib.module {
  name = "gomi";
  meta.description = "Provide gomi and use it as Zsh's rm alias.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [pkgs.gomi];

    zsh.zshrc.gomi.text = ''
      alias rm='gomi'
    '';
  };
}
