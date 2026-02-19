{
  delib,
  inputs,
  lib,
  pkgs,
  ...
}: let
  dppPluginPkgs =
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

  nickel = lib.getExe pkgs.nickel;
  pluginsDir = ../programs/nixvim/plugins/dpp/plugins;
  pluginDirEntries = builtins.readDir pluginsDir;
  excludedPluginNclFiles = ["plugins_contract.ncl"];
  pluginNclFiles =
    builtins.attrNames pluginDirEntries
    |> builtins.filter (fileName:
      (builtins.getAttr fileName pluginDirEntries)
      == "regular"
      && builtins.match "^[a-z0-9-]+\\.ncl$" fileName != null
      && !(builtins.elem fileName excludedPluginNclFiles))
    |> builtins.sort (a: b: a < b);
  pluginTomlExportCommands =
    lib.strings.concatMapStringsSep "\n" (pluginNclFile: let
      pluginTomlFile = lib.strings.removeSuffix ".ncl" pluginNclFile + ".toml";
    in ''
      ${nickel} export --format toml ${pluginsDir}/${pluginNclFile} --apply-contract ${pluginsDir}/plugins_contract.ncl > "$out/${pluginTomlFile}"
    '')
    pluginNclFiles;
  pluginTomls =
    pkgs.runCommand "dpp-shared-plugin-tomls" {
      nativeBuildInputs = [pkgs.nickel pkgs.python3];
    } ''
      mkdir -p "$out"
      ${pluginTomlExportCommands}

      ${lib.getExe pkgs.python3} - <<'PY'
      import pathlib
      import sys
      import tomllib

      plugins_by_repo = {}
      for toml_file in sorted(pathlib.Path("$out").glob("*.toml")):
          with toml_file.open("rb") as handle:
              data = tomllib.load(handle)
          for plugin in data.get("plugins", []):
              repo = plugin.get("repo")
              if not repo:
                  continue
              if repo in plugins_by_repo:
                  print(
                      f"Duplicate dpp plugin repo '{repo}' found in "
                      f"{plugins_by_repo[repo]} and {toml_file.name}",
                      file=sys.stderr,
                  )
                  sys.exit(1)
              plugins_by_repo[repo] = toml_file.name
      PY
    '';
in
  delib.module {
    name = "config.dpp-shared";

    myconfig.always.args.shared.dppShared = {
      inherit dppPluginPkgs pluginTomls;
      sharedHookSources = {
        skkVim = ./dpp-shared/hooks/skk.vim;
      };
    };
  }
