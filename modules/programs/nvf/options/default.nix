{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.nvf";

  home.ifEnabled = {
    programs.nvf.settings.vim = {
      options = {
        number = true;
        relativenumber = false;
        tabstop = 4;
        shiftwidth = 4;
        expandtab = true;
        hlsearch = true;
        ignorecase = true;
        smartcase = true;
        incsearch = true;
        signcolumn = "yes";
        cursorcolumn = true;
        list = true;
        timeout = true;
        timeoutlen = 300;
      };

      autocmds = [
        {
          event = ["TextYankPost"];
          desc = "Highlight yanked text";
          callback = lib.generators.mkLuaInline ''
            function()
              vim.hl.on_yank({ timeout = 300 })
            end
          '';
        }
      ];
    };
  };
}
