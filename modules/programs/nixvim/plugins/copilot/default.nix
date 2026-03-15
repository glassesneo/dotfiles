{
  delib,
  nixvimLsp,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.copilot";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = let
    copilotPkgs = import pkgs.path {
      inherit (pkgs.stdenv.hostPlatform) system;
      config.allowUnfree = true;
    };
  in {
    lsp.servers.copilot = nixvimLsp.mkServer {
      activate = true;
    };

    extraPackages = [
      copilotPkgs.copilot-language-server
      pkgs.nodejs
    ];

    extraPlugins = [
      {
        plugin = pkgs.vimPlugins.copilot-lua;
        optional = true;
      }
    ];

    extraConfigLua = ''
      require('lz.n').load({{
        'copilot.lua',
        cmd = {"Copilot"},
        after = function()
          require('copilot').setup({
            suggestion = { enabled = false },
            panel = { enabled = false },
          })
        end,
      }})
    '';

    extraConfigLuaPost = builtins.readFile ./copilot-lsp.lua;
  };
}
