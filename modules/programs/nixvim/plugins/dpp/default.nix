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
    pluginsDir = ./plugins;
    pluginDirEntries = builtins.readDir pluginsDir;
    # Auto-discovery convention:
    # - Include only plugin source files named `^[a-z0-9-]+\.ncl$`.
    # - Explicitly exclude non-plugin Nickel files (contract, fixtures, scratch).
    # - WARNING: Any scratch `.ncl` matching the pattern is exported and loaded.
    excludedPluginNclFiles = ["plugins_contract.ncl"];
    pluginNclFiles =
      builtins.attrNames pluginDirEntries
      |> builtins.filter (fileName:
        (builtins.getAttr fileName pluginDirEntries) == "regular"
        &&
        builtins.match "^[a-z0-9-]+\\.ncl$" fileName != null
        && !(builtins.elem fileName excludedPluginNclFiles))
      |> builtins.sort (a: b: a < b);
    pluginTomlExportCommands = lib.strings.concatMapStringsSep "\n" (pluginNclFile:
      let
        pluginTomlFile = lib.strings.removeSuffix ".ncl" pluginNclFile + ".toml";
      in ''
        ${nickel} export --format toml ${pluginsDir}/${pluginNclFile} --apply-contract ${pluginsDir}/plugins_contract.ncl > "$out/${pluginTomlFile}"
      '') pluginNclFiles;
    pluginTomls = pkgs.runCommand "dpp-plugins" {buildInputs = [pkgs.nickel];} ''
      mkdir -p "$out"
      ${pluginTomlExportCommands}
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
