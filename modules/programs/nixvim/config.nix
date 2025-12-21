{delib, ...}:
delib.module {
  name = "programs.nixvim";

  home.ifEnabled.programs.nixvim = {
    extraConfigLuaPost = builtins.readFile ./extra_config.lua;
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
    autoCmd = [
      # {
      #   event = "CursorHold";
      #   callback.__raw = ''
      #     function()
      #       vim.diagnostic.open_float({
      #         scope = 'cursor',
      #       })
      #     end
      #   '';
      # }
    ];
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
