{
  delib,
  keymaps,
  lib,
  ...
}: let
  # Neovim-specific RHS for each shared semantic action.
  # Actions not listed here (e.g. pane-*) are Zed-only and skipped.
  neovimActions = {
    goto-file-top = {rhs = "gg";};
    goto-file-bottom = {rhs = "<S-g>";};
    goto-line-start = {rhs = "^";};
    goto-line-end = {rhs = "$";};
    prev-buffer = {
      rhs = null;
      lua = "vim.cmd['bprev']";
    };
    next-buffer = {
      rhs = null;
      lua = "vim.cmd['bnext']";
    };
    save-file = {
      rhs = null;
      lua = "vim.cmd['w']";
    };
    disable-macro-record = {rhs = "<Nop>";};
    match-bracket = {rhs = "%";};
  };

  # Generate a vim.keymap.set Lua call from a shared action + Neovim translation
  mkKeymapLua = name: let
    action = keymaps.${name};
    nvim = neovimActions.${name};
    modesLua = ''{ ${lib.concatMapStringsSep ", " (m: ''"${m}"'') action.modes} }'';
    rhsPart =
      if nvim ? lua && nvim.lua != null
      then nvim.lua
      else ''[[${nvim.rhs}]]'';
  in ''vim.keymap.set(${modesLua}, [[${action.key}]], ${rhsPart}, { silent = true })'';

  sharedKeymapLua = assert builtins.all (name: keymaps ? ${name}) (builtins.attrNames neovimActions);
    lib.concatStringsSep "\n" (
      map mkKeymapLua (builtins.attrNames neovimActions)
    );
in
  delib.module {
    name = "programs.nixvim";

    home.ifEnabled.programs.nixvim = {
      extraConfigLuaPost = sharedKeymapLua + "\n" + builtins.readFile ./extra_config.lua;
      opts = {
        helplang = ["en"];
        number = true;
        # relativenumber = true;
        cursorcolumn = true;
        signcolumn = "yes";
        list = true;
        cmdheight = 0;
        # winblend = 5;
        # pumblend = 0;
        winborder = "bold";
        termguicolors = true;
        wildoptions = "pum";
        laststatus = 1;
        showcmd = true;
        # background = "dark";
        ruler = true;
        showtabline = 1;
        hlsearch = true;
        ignorecase = true;
        smartcase = true;
        incsearch = true;
        foldenable = false;
        wrap = true;
        confirm = true;
        hidden = true;
        autoread = true;
        autoindent = true;
        smartindent = true;
        clipboard = "unnamed";
        completeopt = ["menuone" "noinsert"];
        wildmenu = true;
        timeout = true;
        timeoutlen = 300;
        tabstop = 2;
        softtabstop = 2;
        shiftwidth = 2;
        expandtab = true;
      };
      diagnostic.settings = {
        severity_sort = true;
        float = {
          border = "none";
          # title = "Diagnostics";
          header = {};
          suffix = {};
          format.__raw = ''
            function(diag)
              if diag.code then
                return string.format("[%s](%s): %s", diag.message, diag.source, diag.code)
              else
                return string.format("[%s]: %s", diag.message, diag.source)
              end
            end
          '';
        };
        virtual_text = {
          format.__raw = ''
            function(diag)
              return string.format("%s (%s: %s)", diag.message, diag.source, diag.code)
            end
          '';
        };
        # virtual_lines = {
        # current_line = true;
        # };
        underline = true;
      };
      performance = {
        byteCompileLua = {
          configs = true;
          initLua = true;
          luaLib = true;
          nvimRuntime = true;
          plugins = true;
        };
      };
    };
  }
