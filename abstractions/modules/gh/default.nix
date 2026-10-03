{delib, ...}:
delib.module {
  name = "gh";
  meta.description = "Provide the GitHub CLI.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [pkgs.gh];
  };
}
