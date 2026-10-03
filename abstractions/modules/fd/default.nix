{delib, ...}:
delib.module {
  name = "fd";
  meta.description = "Provide fd for finding files and directories.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [pkgs.fd];
  };
}
