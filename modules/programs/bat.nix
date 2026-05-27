{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.bat";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled.programs.bat = {
    enable = true;
    extraPackages = with pkgs.bat-extras; [
      batdiff
      prettybat
    ];
    # config = {
    # style = "plain,changes";
    # };
  };
}
