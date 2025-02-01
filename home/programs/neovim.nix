{ pkgs, ... }:
{
  xdg.configFile.nvim.source = ../../nvim;

  home.sessionVariables = {
    EDITOR = "nvim";
    VISUAL = "nvim";
  };

  programs.neovim = {
    enable = true;
    extraLuaConfig = builtins.readFile ../../nvim/init.lua;
    withNodeJs = false;
    withPython3 = false;
    withRuby = false;
    extraPackages = with pkgs; [
      # lsp
      efm-langserver
      vim-language-server
      #typescript
      biome
      typescript-language-server
      svelte-language-server
      tailwindcss-language-server
      # tree-sitter
      tree-sitter
      # denops
      deno
      # tree-sitter
      gcc
      # nim
      nimlangserver
      # nix
      nil
      nixfmt-rfc-style
      # scala
      scalafmt
      metals
      # lua
      lua-language-server
      stylua
      # toml
      taplo
      # markdown
      marksman
      # python
      pylyzer
      ruff
      # kotlin
      kotlin-language-server
      ktfmt
      # zig
      zls
    ];
  };
}
