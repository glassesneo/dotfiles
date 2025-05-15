{
  pkgs,
  lib,
  inputs,
  ...
}: {
  programs.nixvim = {
    enable = true;
    extraConfigLuaPre = builtins.readFile ./config.lua;
    extraPackages = with pkgs; [
      deno
      efm-langserver
      stylua
      alejandra
    ];
    withNodeJs = false;
    withPerl = false;
    withPython3 = false;
    withRuby = false;
    autoCmd = [
      {
        event = "TextYankPost";
        pattern = ["*"];
        callback.__raw = ''
          function()
            vim.highlight.on_yank({ timeout = 300 })
          end
        '';
      }
    ];
    imports = [
      (import ./plugins/dpp.nix {inherit pkgs lib inputs;})
      ./options.nix
      ./diagnostic.nix
      ./filetypes.nix
      ./performance.nix
      ./lsp.nix
      ./colorscheme.nix
      ./plugins/ai.nix
      ./plugins/bypass.nix
      ./plugins/depends.nix
      ./plugins/editing.nix
      ./plugins/git.nix
      ./plugins/lang.nix
      # ./plugins/lsp.nix
      # ./plugins/format.nix
      ./plugins/lint.nix
      ./plugins/lz-n.nix
      ./plugins/motion.nix
      ./plugins/statusline.nix
      ./plugins/ui.nix
      ./plugins/visibility.nix
    ];
  };
}
