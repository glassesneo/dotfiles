{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.orbstack";

  options = delib.singleEnableOption (pkgs.stdenv.isDarwin && host.devCoreFeatured);

  home.ifEnabled = {
    home.packages = [
      pkgs.orbstack
    ];
  };
}
