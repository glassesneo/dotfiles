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

  tomlFormat = pkgs.formats.toml {};

  # Assert all plugins in a list have the required 'repo' field
  assertHaveRepo = filename: plugins:
    map (plugin:
      if !(plugin ? repo)
      then throw "DPP plugin in ${filename} is missing required 'repo' field"
      else plugin)
    plugins;

  # Nix-native plugin data (migrated from modules/programs/nixvim/plugins/dpp/plugins/*.ncl)

  editingPlugins = assertHaveRepo "editing" [
    {
      repo = "ysmb-wtsg/in-and-out.nvim";
      "if" = "has('nvim')";
      on_map = {i = "<C-CR>";};
      lua_add = "";
      lua_source = "  require(\"in-and-out\").setup({\n      additional_targets = { \"$\" }\n  })\n  vim.keymap.set(\"i\", \"<C-CR>\", function()\n    require(\"in-and-out\").in_and_out()\n  end)\n";
    }
  ];

  motionPlugins = assertHaveRepo "motion" [
    {
      repo = "lambdalisue/kensaku.vim";
    }
    {
      repo = "lambdalisue/kensaku-search.vim";
      "if" = "has('nvim')";
      depends = ["kensaku.vim"];
      on_map = {c = "<Plug>(kensaku-search-replace)";};
      lua_add = "  vim.keymap.set(\"c\", \"<CR>\", function()\n    return vim.fn.getcmdtype()  == \"/\" and \"<Plug>(kensaku-search-replace)<CR>\" or \"<CR>\"\n  end, { expr = true })\n";
    }
    {
      repo = "yuki-yano/fuzzy-motion.vim";
      "if" = "has('nvim')";
      depends = ["kensaku.vim"];
      on_cmd = "FuzzyMotion";
      lua_add = "  vim.keymap.set(\"n\", \"<S-s>\", function()\n    vim.cmd[\"FuzzyMotion\"]()\n  end, { noremap = true })\n";
      lua_source = "  vim.g[\"fuzzy_motion_matchers\"] = { \"kensaku\", \"fzf\" }\n";
    }
    {
      repo = "skanehira/jumpcursor.vim";
      "if" = "has('nvim')";
      on_map = "<Plug>(jumpcursor-jump)";
      lua_add = "  vim.keymap.set(\"n\", \"<CR>j\", \"<Plug>(jumpcursor-jump)\")\n";
    }
  ];

  skkPlugins = assertHaveRepo "skk" [
    {
      repo = "vim-skk/skkeleton";
      on_event = ["InsertEnter" "CmdlineEnter"];
      hooks_file = "$DPP_HOOK_DIR/skk.vim";
      hook_add = "  imap <C-j> <Plug>(skkeleton-enable)\n  cmap <C-j> <Plug>(skkeleton-enable)\n  imap <C-l> <Plug>(skkeleton-disable)\n  cmap <C-l> <Plug>(skkeleton-disable)\n";
    }
    {
      repo = "delphinus/skkeleton_indicator.nvim";
      on_source = "skkeleton";
      "if" = "has('nvim')";
      lua_source = "  require(\"skkeleton_indicator\").setup({\n    border = \"solid\",\n    fadeOutMs = 1200,\n    eijiText = \"en\",\n  })\n";
    }
  ];

  ddcPlugins = assertHaveRepo "ddc" [
    {
      repo = "Shougo/ddc.vim";
      "if" = "!has('nvim')";
      on_event = ["InsertEnter" "CmdlineEnter"];
      hooks_file = "$DPP_HOOK_DIR/ddc.vim";
    }
    {
      repo = "Shougo/pum.vim";
      "if" = "!has('nvim')";
      on_source = "ddc.vim";
    }
    {
      repo = "Shougo/ddc-ui-pum";
      "if" = "!has('nvim')";
      on_source = "ddc.vim";
    }
    {
      repo = "Shougo/ddc-source-around";
      "if" = "!has('nvim')";
      on_source = "ddc.vim";
    }
    {
      repo = "LumaKernel/ddc-source-file";
      "if" = "!has('nvim')";
      on_source = "ddc.vim";
    }
    {
      repo = "Shougo/ddc-source-vim";
      "if" = "!has('nvim')";
      on_source = "ddc.vim";
    }
    {
      repo = "prabirshrestha/vim-lsp";
      "if" = "!has('nvim')";
      on_source = "ddc.vim";
      hooks_file = "$DPP_HOOK_DIR/vim-lsp.vim";
    }
    {
      repo = "shun/ddc-source-vim-lsp";
      "if" = "!has('nvim')";
      on_source = "ddc.vim";
    }
    {
      repo = "tani/ddc-fuzzy";
      "if" = "!has('nvim')";
      on_source = "ddc.vim";
    }
    {
      repo = "Shougo/ddc-converter_remove_overlap";
      "if" = "!has('nvim')";
      on_source = "ddc.vim";
    }
    {
      repo = "Shougo/ddc-filter-matcher_head";
      "if" = "!has('nvim')";
      on_source = "ddc.vim";
    }
    {
      repo = "Shougo/ddc-filter-sorter_rank";
      "if" = "!has('nvim')";
      on_source = "ddc.vim";
    }
  ];

  # Generate a TOML derivation for each plugin group
  editingToml = tomlFormat.generate "editing.toml" {plugins = editingPlugins;};
  motionToml = tomlFormat.generate "motion.toml" {plugins = motionPlugins;};
  skkToml = tomlFormat.generate "skk.toml" {plugins = skkPlugins;};
  ddcToml = tomlFormat.generate "ddc.toml" {plugins = ddcPlugins;};

  # Python script for duplicate-repo validation across all TOML files
  duplicateCheckScript = pkgs.writeText "dpp-duplicate-check.py" ''
    import pathlib
    import sys
    import tomllib

    out_dir = pathlib.Path(sys.argv[1])
    plugins_by_repo = {}
    for toml_file in sorted(out_dir.glob("*.toml")):
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
  '';

  # nvim: excludes ddc (Vim-only completion plugin)
  pluginTomlsNvim =
    pkgs.runCommand "dpp-shared-plugin-tomls-nvim" {
      nativeBuildInputs = [pkgs.python3];
    } ''
      mkdir -p "$out"
      cp ${editingToml} "$out/editing.toml"
      cp ${motionToml} "$out/motion.toml"
      cp ${skkToml} "$out/skk.toml"

      python3 ${duplicateCheckScript} "$out"
    '';

  # vim: includes all plugins (ddc is vim-only)
  pluginTomlsVim =
    pkgs.runCommand "dpp-shared-plugin-tomls-vim" {
      nativeBuildInputs = [pkgs.python3];
    } ''
      mkdir -p "$out"
      cp ${editingToml} "$out/editing.toml"
      cp ${motionToml} "$out/motion.toml"
      cp ${skkToml} "$out/skk.toml"
      cp ${ddcToml} "$out/ddc.toml"

      python3 ${duplicateCheckScript} "$out"
    '';
in
  delib.module {
    name = "config.dpp-shared";

    myconfig.always.args.shared.dppShared = {
      inherit dppPluginPkgs pluginTomlsNvim pluginTomlsVim;
      sharedHookSources = {
        skkVim = ./dpp-shared/hooks/skk.vim;
      };
    };
  }
