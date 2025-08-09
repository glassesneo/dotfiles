{delib, ...}:
delib.module {
  name = "programs.nixvim.plugins.lz-n";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim.plugins.lz-n = {
    enable = true;
  };
}
