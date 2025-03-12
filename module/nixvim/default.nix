{
  pkgs,
  lib,
  inputs,
  ...
}: {
  programs.nixvim = {
    enable = true;
    extraConfigLuaPre = builtins.readFile ./keymaps.lua;
    extraConfigLua = ''
      vim.cmd("filetype plugin on")

      --- lsp
      vim.diagnostic.config({ severity_sort = true })

      vim.lsp.handlers["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, {
        border = "rounded",
      })
      vim.api.nvim_create_autocmd("LspAttach", {
        group = vim.api.nvim_create_augroup("UserLspConfig", {}),
        callback = function(ev)
          local client = vim.lsp.get_client_by_id(ev.data.client_id)
          if client == nil then
            return
          end
        end,
      })

      -- vim.g["denops#debug"] = 1
    '';
    extraPackages = with pkgs; [
      deno
    ];
    withNodeJs = false;
    withPerl = false;
    withPython3 = false;
    withRuby = false;
    colorschemes.catppuccin = {
      enable = true;
      settings = {
        flavour = "mocha";
        transparent_background = true;
        term_colors = true;
        integrations = {
          gitsigns = true;
          treesitter = true;
          notify = true;
        };
      };
    };
    imports = [
      ./options.nix
      ./plugins/bypass.nix
      ./plugins/depends.nix
      ./plugins/editing.nix
      ./plugins/git.nix
      ./plugins/lsp.nix
      ./plugins/motion.nix
      ./plugins/snippet.nix
      ./plugins/statusline.nix
      ./plugins/ui.nix
      ./plugins/visibility.nix
      (import ./plugins/dpp.nix {inherit pkgs lib inputs;})
    ];
  };
}
