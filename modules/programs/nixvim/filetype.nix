{delib, ...}:
delib.module {
  name = "programs.nixvim";

  home.ifEnabled.programs.nixvim = {
    extraConfigLua = builtins.readFile ./filetype.lua;
  };
}
