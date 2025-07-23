{pkgs, ...}: let
  treesitter_ft = [
    "bash"
    "c"
    "css"
    "dockerfile"
    "elm"
    "gitcommit"
    "gitignore"
    "git_config"
    "git_rebase"
    "go"
    "haskell"
    "html"
    "json"
    "kotlin"
    "lua"
    "markdown"
    "nim"
    "nim_format_string"
    "nix"
    "nu"
    "python"
    "query"
    "regex"
    "ssh_config"
    "toml"
    "tsx"
    "typescript"
    "typst"
    "vimdoc"
    "yaml"
    "zig"
  ];
in {
  plugins = {
    web-devicons = {
      enable = true;
    };
    treesitter = {
      enable = true;
      lazyLoad = {
        enable = true;
        settings = {
          ft = treesitter_ft;
        };
      };
      grammarPackages = map (grammar: pkgs.vimPlugins.nvim-treesitter.builtGrammars."${grammar}") treesitter_ft;
      # grammarPackages = with pkgs.vimPlugins.nvim-treesitter.builtGrammars; [
      # bash
      # c
      # css
      # dockerfile
      # elm
      # gitcommit
      # gitignore
      # go
      # haskell
      # html
      # json
      # kotlin
      # lua
      # markdown
      # markdown_inline
      # nim
      # nim_format_string
      # nix
      # nu
      # python
      # query
      # regex
      # rust
      # ssh_config
      # svelte
      # toml
      # tsx
      # typescript
      # v
      # vim
      # vimdoc
      # yaml
      # zig
      # ];
      settings = {
        highlight.enable = true;
        indent.enable = true;
      };
    };
  };
  extraPlugins = with pkgs.vimPlugins; [
    plenary-nvim
  ];
}
