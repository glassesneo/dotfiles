{
  extraConfigLuaPre = ''
    vim.cmd('filetype plugin indent on')
  '';
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
}
