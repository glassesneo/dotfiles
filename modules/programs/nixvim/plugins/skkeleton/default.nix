{
  delib,
  homeConfig,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.skkeleton";

  options.programs.nixvim.plugins.skkeleton = with delib; {
    enable = boolOption true;
    skkeletonUserDictPath = lib.mkOption {
      type = lib.types.str;
      default = "${homeConfig.xdg.dataHome}/skkeleton/jisyo";
      description = "Path to the user dictionary for skkeleton.";
    };
  };

  # deno runtime is provided by denops.nix
  home.ifEnabled = {cfg, ...}: {
    programs.nixvim = {
      extraPlugins = [pkgs.vimPlugins.skkeleton];
      extraConfigLua =
        pkgs.replaceVars ./config.lua {
          skk-dict-path = "${pkgs.skkDictionaries.l}/share/skk/SKK-JISYO.L";
          user-dict-path = cfg.skkeletonUserDictPath;
        }
        |> builtins.readFile;
    };
  };
}
