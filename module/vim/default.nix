{
  pkgs,
  config,
  lib,
  ...
}: {
  programs.vim = {
    enable = true;
    packageConfigurable = pkgs.vim;
    settings = {
      # Basic vim settings
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

    # Basic plugins - you can expand this later
    plugins = with pkgs.vimPlugins; [
      # Essential plugins
      vim-airline
      vim-airline-themes

      # File navigation
      nerdtree

      # Git integration
      vim-fugitive

      # Syntax highlighting
      vim-polyglot

      # Color schemes
      gruvbox
      tokyonight-nvim
    ];

    # Extra configuration
    extraConfig = ''
      " Color scheme
      syntax enable
      colorscheme gruvbox

      " Key mappings
      let mapleader = " "

      " NERDTree
      map <C-n> :NERDTreeToggle<CR>

      " Better navigation
      nnoremap <C-h> <C-w>h
      nnoremap <C-j> <C-w>j
      nnoremap <C-k> <C-w>k
      nnoremap <C-l> <C-w>l

      " Quick save and quit
      nnoremap <leader>w :w<CR>
      nnoremap <leader>q :q<CR>

      " Clear search highlighting
      nnoremap <leader>/ :nohlsearch<CR>

      " Better indentation
      vnoremap < <gv
      vnoremap > >gv

      " Airline configuration
      let g:airline_theme='gruvbox'
      let g:airline#extensions#tabline#enabled = 1

      " File type specific settings
      autocmd FileType nix setlocal ts=2 sw=2 expandtab
      autocmd FileType yaml setlocal ts=2 sw=2 expandtab
      autocmd FileType json setlocal ts=2 sw=2 expandtab
    '';
  };
}
