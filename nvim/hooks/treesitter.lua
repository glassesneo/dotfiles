--- lua_source {{{
require("nvim-treesitter.configs").setup({
  ensure_installed = {
    "bash",
    "c",
    "cpp",
    "css",
    "dockerfile",
    "elm",
    "gitcommit",
    "gitignore",
    "haskell",
    "html",
    "json",
    "kotlin",
    "lua",
    "markdown",
    "markdown_inline",
    "nim",
    "nim_format_string",
    "nix",
    "python",
    "query",
    "regex",
    "rust",
    "ssh_config",
    "svelte",
    "toml",
    "tsx",
    "typescript",
    "v",
    "vim",
    "vimdoc",
    "zig",
  },
  sync_install = true,
  auto_install = false,
  ignore_install = { "all" },
  injection = {
    enable = true,
  },
  highlight = {
    enable = true,
  },
  indent = {
    enable = true,
  },
  modules = {
    autotag = {
      enable = true,
      filetypes = {
        "html",
        "svelte",
        "typescript",
      },
    },
  },
})
--- }}}
