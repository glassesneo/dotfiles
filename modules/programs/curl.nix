{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.curl";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    home.packages = with pkgs; [
      curl
    ];
  };
}
