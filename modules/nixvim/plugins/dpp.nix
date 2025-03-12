{
  pkgs,
  inputs,
  ...
}: let
  dpp = pkgs.vimUtils.buildVimPlugin {
    name = "dpp.vim";
    src = inputs.dpp-vim;
    # src = pkgs.fetchFromGitHub {
    # owner = "Shougo";
    # repo = "dpp.vim";
    # rev = "188f2852326d2e962f9afbf92d5bcb395ca2cb56";
    # hash = "sha256-UsKiSu0wtC0vdb7DZfvfrbqeHVXx5OPS/L2f/iABIWw=";
    # };
  };
in {
  extraPlugins = [
    dpp
  ];
  extraConfigLuaPost = ''
    local configDir = vim.env.HOME .. "/.config/dpp"
    vim.env.BASE_DIR = configDir
    vim.env.RC_DIR = configDir .. "/rc"
    vim.env.PLUGIN_DIR = configDir .. "/plugins"
    vim.env.HOOK_DIR = configDir .. "/hooks"

    -- local dpp_src = ${dpp};
    -- local denops_src = ${pkgs.vimPlugins.denops-vim};

    -- vim.opt.runtimepath:prepend(dpp_src)
    local dpp = require("dpp")

    local dpp_base = "$XDG_CACHE_HOME/dpp"
    local dpp_config = "$RC_DIR/dpp.ts"

    local ext_toml = "$XDG_CACHE_HOME/dpp/repos/github.com/Shougo/dpp-ext-toml"
    local ext_lazy = "$XDG_CACHE_HOME/dpp/repos/github.com/Shougo/dpp-ext-lazy"
    local ext_installer = "$XDG_CACHE_HOME/dpp/repos/github.com/Shougo/dpp-ext-installer"
    local ext_git = "$XDG_CACHE_HOME/dpp/repos/github.com/Shougo/dpp-protocol-git"

    vim.opt.runtimepath:append(ext_toml)
    vim.opt.runtimepath:append(ext_lazy)
    vim.opt.runtimepath:append(ext_installer)
    vim.opt.runtimepath:append(ext_git)

    -- vim.g.denops_server_addr = "127.0.0.1:32121"

    if dpp.load_state(dpp_base) then
      -- vim.opt.runtimepath:prepend(denops_src)

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

    --- install
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
