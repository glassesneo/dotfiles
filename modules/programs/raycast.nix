{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.raycast";

  options = delib.singleEnableOption pkgs.stdenv.isDarwin;

  home.ifEnabled = {
    home.packages = [
      pkgs.raycast
    ];
  };
}
