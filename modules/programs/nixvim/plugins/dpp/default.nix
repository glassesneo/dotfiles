{
  delib,
  homeConfig,
  inputs,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.dpp";

  options = delib.singleEnableOption true;

  home.ifEnabled = let
    dpp-plugins =
      inputs
      |> lib.attrsets.getAttrs [
        "dpp-vim"
        "dpp-ext-installer"
        "dpp-ext-lazy"
        "dpp-ext-toml"
        "dpp-protocol-git"
      ]
      |> lib.attrsets.mapAttrsToList (name: src:
        pkgs.vimUtils.buildVimPlugin {
          inherit name src;
          dependencies = [pkgs.vimPlugins.denops-vim];
        });
    dpp-rtp-config =
      lib.strings.concatMapStrings (plugin: ''
        vim.opt.runtimepath:prepend("${plugin}")
      '')
      dpp-plugins;
    nickel = lib.getExe pkgs.nickel;
    pluginTomls = pkgs.runCommand "dpp-plugins" {buildInputs = [pkgs.nickel];} ''
      mkdir -p $out
      ${nickel} export --format toml ${./plugins/editing.ncl} > $out/editing.toml
      ${nickel} export --format toml ${./plugins/motion.ncl} > $out/motion.toml
      ${nickel} export --format toml ${./plugins/skk.ncl} > $out/skk.toml
    '';
  in {
    xdg.configFile = {
      "dpp/dpp.ts" = {
        source = pkgs.replaceVars ./dpp.ts {
          plugin-dir-path = "${homeConfig.xdg.configHome}/dpp/plugins";
        };
      };
      "dpp/plugins" = {
        source = pluginTomls;
      };
      "dpp/hooks/skk.lua" = {
        source = pkgs.replaceVars ./hooks/skk.lua {
          skk-dict-path = "${pkgs.skkDictionaries.l}/share/skk/SKK-JISYO.L";
        };
      };
    };
    programs.nixvim = {
      env = {
        DPP_HOOK_DIR = "${homeConfig.xdg.configHome}/dpp/hooks";
      };
      extraPlugins = [pkgs.vimPlugins.denops-vim];
      extraConfigLuaPre = dpp-rtp-config + builtins.readFile ./setup-dpp.lua;
    };
  };
}
