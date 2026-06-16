{delib, ...}:
delib.module {
  name = "programs.nvf";

  home.ifEnabled = {
    programs.nvf.settings.vim.treesitter = {
      enable = true;
    };
  };
}
