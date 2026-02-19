{
  delib,
  brewCasks,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.proton-drive";

  options = delib.singleEnableOption (pkgs.stdenv.isDarwin && host.guiShellFeatured);

  home.ifEnabled = {
    home.packages = [
      brewCasks.proton-drive
    ];
  };
}
