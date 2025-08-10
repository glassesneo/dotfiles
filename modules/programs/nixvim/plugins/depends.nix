{
  delib,
  pkgs,
  ...
}: let
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
in
  delib.module {
    name = "programs.nixvim.plugins.depends";

    options = delib.singleEnableOption true;

    home.ifEnabled.programs.nixvim = {
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
          settings = {
            highlight.enable = true;
            indent.enable = true;
          };
        };
      };
      extraPlugins = with pkgs.vimPlugins; [
        plenary-nvim
      ];
    };
  }
