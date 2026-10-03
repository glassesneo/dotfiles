{delib, ...}:
delib.module {
  name = "ripgrep";
  meta.description = "Provide ripgrep for searching file contents.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [pkgs.ripgrep];
  };
}
