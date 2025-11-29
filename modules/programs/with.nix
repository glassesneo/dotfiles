{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.with";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    home.packages = with pkgs; [
      with-shell
    ];
  };
}
