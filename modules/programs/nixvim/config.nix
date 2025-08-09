{delib, ...}:
delib.module {
  name = "programs.nixvim";

  home.ifEnabled.programs.nixvim = {
    extraConfigLuaPre = builtins.readFile ./extra_config.lua;
    opts = {
      helplang = ["en"];
      number = true;
      # relativenumber = true;
      cursorcolumn = true;
      signcolumn = "yes";
      list = true;
      cmdheight = 1;
      winblend = 40;
      pumblend = 20;
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
        border = "single";
        title = "Diagnostics";
        header = {};
        suffix = {};
        format.__raw = ''
          function(diag)
            if diag.code then
              return string.format("[%s](%s): %s", diag.source, diag.code, diag.message)
            else
              return string.format("[%s]: %s", diag.source, diag.message)
            end
          end
        '';
      };
    };
    performance = {
      byteCompileLua = {
        configs = true;
        # initLua = true;
        nvimRuntime = true;
        plugins = true;
      };
    };
  };
}
