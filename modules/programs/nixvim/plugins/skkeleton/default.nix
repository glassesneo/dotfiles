{
  delib,
  homeConfig,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.skkeleton";

  options = delib.singleEnableOption true;

  # deno runtime is provided by denops.nix
  home.ifEnabled.programs.nixvim = {
    extraPlugins = [pkgs.vimPlugins.skkeleton];
    extraConfigLua =
      pkgs.replaceVars ./config.lua {
        skk-dict-path = "${pkgs.skkDictionaries.l}/share/skk/SKK-JISYO.L";
        user-dict-path = "${homeConfig.xdg.configHome}/.skkeleton";
      }
      |> builtins.readFile;
  };
}
