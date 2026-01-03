{
  delib,
  pkgs,
  lib,
  ...
}: let
  # Grammar names used by nvim-treesitter (for grammarPackages)
  treesitter_grammars = [
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
    "htmldjango"
    "json"
    "kotlin"
    "lua"
    "markdown"
    "nim"
    "nim_format_string"
    "nix"
    "nu"
    "prisma"
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

  # Mapping from grammar name to filetypes (when different)
  # Most grammars have the same name as their filetype
  # Vim filetypes often omit underscores that grammar names have
  grammarToFiletypes = {
    git_config = ["gitconfig"];
    git_rebase = ["gitrebase"];
    ssh_config = ["sshconfig"];
    vimdoc = ["vimdoc" "help" "checkhealth"];
    # nim_format_string is an injected grammar, not a standalone filetype
    nim_format_string = [];
  };

  # Generate filetypes list from grammars
  treesitter_ft = lib.flatten (
    map (
      grammar: grammarToFiletypes.${grammar} or [grammar]
    )
    treesitter_grammars
  );

  # Query-only packages needed for inheritance (no parser, just queries)
  # html and htmldjango inherit from html_tags for highlighting
  treesitter_queries = [
    pkgs.vimPlugins.nvim-treesitter.passthru.queries.html_tags
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
              ft = treesitter_ft ++ ["org"];
            };
          };
          grammarPackages = map (grammar: pkgs.vimPlugins.nvim-treesitter.builtGrammars."${grammar}") treesitter_grammars;
          settings = {
            highlight.enable = true;
            indent.enable = true;
          };
        };
      };
      extraPlugins = with pkgs.vimPlugins; [
        plenary-nvim
      ] ++ treesitter_queries;
    };
  }
