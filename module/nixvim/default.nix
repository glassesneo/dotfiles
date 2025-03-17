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
    # wrapRc = false;
    imports = [
      (import ./plugins/dpp.nix {inherit pkgs lib inputs;})
      ./options.nix
      ./colorscheme.nix
      ./plugins/bypass.nix
      ./plugins/depends.nix
      ./plugins/editing.nix
      ./plugins/git.nix
      ./plugins/lsp.nix
      ./plugins/motion.nix
      ./plugins/statusline.nix
      ./plugins/ui.nix
      ./plugins/visibility.nix
    ];
  };
}
