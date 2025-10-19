{delib, ...}:
delib.module {
  name = "programs.nix-index";

  options = delib.singleEnableOption false;

  home.ifEnabled = {
    programs.nix-index = {
      enable = true;
    };
  };
}
