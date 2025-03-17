{
  pkgs,
  lib,
  inputs,
  ...
}: let
  dpp-plugins =
    lib.attrsets.mapAttrsToList
    (name: src: pkgs.vimUtils.buildVimPlugin {inherit name src;}) (lib.attrsets.getAttrs
      [
        "dpp-vim"
        "dpp-ext-installer"
        "dpp-ext-lazy"
        "dpp-ext-toml"
        "dpp-protocol-git"
      ]
      inputs);
  dpp-rtp-config =
    lib.strings.concatMapStrings (plugin: ''
      vim.opt.runtimepath:prepend("${plugin}")
    '')
    dpp-plugins;
in {
  extraPlugins = [pkgs.vimPlugins.denops-vim];
  extraConfigLuaPre = ''
    local configDir = vim.env.HOME .. "/.config/dpp"
    vim.env.BASE_DIR = configDir
    vim.env.RC_DIR = configDir .. "/rc"
    vim.env.PLUGIN_DIR = configDir .. "/plugins"
    vim.env.HOOK_DIR = configDir .. "/hooks"

    ${dpp-rtp-config}

    local dpp = require("dpp")

    local dpp_base = "$XDG_CACHE_HOME/dpp"
    local dpp_config = "$RC_DIR/dpp.ts"

    if dpp.load_state(dpp_base) then
      vim.api.nvim_create_autocmd("User", {
        pattern = "DenopsReady",
        callback = function()
          vim.notify("vim load_state is failed")
          dpp.make_state(dpp_base, dpp_config)
        end,
      })
    end

    vim.api.nvim_create_autocmd("User", {
      pattern = "Dpp:makeStatePost",
      callback = function()
        vim.notify("dpp make_state() is done")
      end,
    })

    -- install
    vim.api.nvim_create_user_command("DppInstall", "call dpp#async_ext_action('installer', 'install')", {})

    -- update
    vim.api.nvim_create_user_command("DppUpdate", function(opts)
      local args = opts.fargs
      vim.fn["dpp#async_ext_action"]("installer", "update", { names = args })
    end, { nargs = "*" })

    -- check update
    vim.api.nvim_create_user_command("DppCheckUpdate", "call dpp#async_ext_action('installer', 'checkNotUpdated')", {})

    vim.api.nvim_create_user_command("DppClearState", "call dpp#clear_state()", {})
  '';
}
