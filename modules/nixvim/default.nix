{pkgs, ...}: {
  programs.nixvim = {
    enable = true;
    extraConfigLua = builtins.readFile ../../nvim/lua/commons/keymaps.lua;
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
        flavour = "macchiato";
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
      ./plugins/editting.nix
      ./plugins/lsp.nix
      ./plugins/motion.nix
      ./plugins/snippet.nix
      ./plugins/statusline.nix
      ./plugins/ui.nix
      ./plugins/visibility.nix
    ];
  };
}
