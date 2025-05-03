{
  pkgs,
  lib,
  inputs,
  ...
}: {
  programs.nixvim = {
    enable = true;
    extraConfigLuaPre = builtins.readFile ./keymaps.lua;
    extraConfigLua = builtins.readFile ./config.lua;
    extraPackages = with pkgs; [
      deno
      lua-language-server
      stylua
      nil
      alejandra
    ];
    withNodeJs = false;
    withPerl = false;
    withPython3 = false;
    withRuby = false;
    imports = [
      (import ./plugins/dpp.nix {inherit pkgs lib inputs;})
      ./options.nix
      ./diagnostic.nix
      ./performance.nix
      # ./lsp.nix
      ./colorscheme.nix
      ./plugins/ai.nix
      ./plugins/bypass.nix
      ./plugins/depends.nix
      ./plugins/editing.nix
      ./plugins/git.nix
      ./plugins/lang.nix
      ./plugins/lsp.nix
      ./plugins/format.nix
      ./plugins/lint.nix
      ./plugins/lz-n.nix
      ./plugins/motion.nix
      ./plugins/statusline.nix
      ./plugins/ui.nix
      ./plugins/visibility.nix
    ];
  };
}
