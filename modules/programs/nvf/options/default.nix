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
        # Default border for floats that omit an explicit border (LSP hover,
        # signature help, diagnostics, blink.cmp, etc.). Plugins that set
        # border themselves (fidget, orgmode, Noice cmdline) are unchanged.
        winborder = "rounded";
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
