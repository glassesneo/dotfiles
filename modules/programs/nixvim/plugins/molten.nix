{delib, ...}:
delib.module {
  name = "programs.nixvim.plugins.molten";

  options = delib.singleEnableOption false;

  home.ifEnabled.programs.nixvim = {
    plugins = {
      molten = {
        enable = true;
      };
    };
  };
}
