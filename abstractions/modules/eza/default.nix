{delib, ...}:
delib.module {
  name = "eza";
  meta.description = "Provide eza for listing files and directories.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [pkgs.eza];
  };
}
