{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nvf.motion";
  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nvf.settings.vim.lazy.plugins = {
    "clever-f.vim" = {
      package = pkgs.vimPlugins.clever-f-vim;
      before = ''
        vim.g.clever_f_smart_case = 1
        vim.g.clever_f_timeout_ms = 2000
      '';
      keys = map (key: {
        inherit key;
        mode = ["n" "x" "o"];
      }) ["f" "F" "t" "T" ";" ","];
    };
    vim-asterisk = {
      package = pkgs.vimPlugins.vim-asterisk;
      keys = [
        {
          key = "*";
          mode = ["n" "x" "o"];
          action = "<Plug>(asterisk-z*)";
          noremap = false;
        }
        {
          key = "#";
          mode = ["n" "x" "o"];
          action = "<Plug>(asterisk-z#)";
          noremap = false;
        }
        {
          key = "g*";
          mode = ["n" "x" "o"];
          action = "<Plug>(asterisk-gz*)";
          noremap = false;
        }
        {
          key = "g#";
          mode = ["n" "x" "o"];
          action = "<Plug>(asterisk-gz#)";
          noremap = false;
        }
      ];
    };
  };
}
