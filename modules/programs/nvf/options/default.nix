{delib, ...}:
delib.module {
  name = "programs.nvf";

  home.ifEnabled = {
    programs.nvf.settings.vim.options = {
      number = true;
      relativenumber = false;
      tabstop = 4;
      shiftwidth = 4;
      expandtab = true;
    };
  };
}
