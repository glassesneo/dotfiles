{pkgs, ...}: {
  plugins = {
    web-devicons = {
      enable = true;
    };
    treesitter = {
      enable = true;
      grammarPackages = with pkgs.vimPlugins.nvim-treesitter.builtGrammars; [
        bash
        c
        css
        dockerfile
        elm
        gitcommit
        gitignore
        haskell
        html
        json
        kotlin
        lua
        markdown
        markdown_inline
        nim
        nim_format_string
        nix
        nu
        python
        query
        regex
        rust
        ssh_config
        svelte
        toml
        tsx
        typescript
        v
        vim
        vimdoc
        zig
      ];
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
