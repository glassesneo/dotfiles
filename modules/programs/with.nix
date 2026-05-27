{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.with";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled = {
    home.packages = with pkgs; [
      with-shell
    ];
  };
}
