" vim configuration (aligned with nixvim settings)
" Enable syntax and filetype detection
syntax enable
filetype plugin indent on

" ============================================================================
" Display Settings
" ============================================================================
set number
" set relativenumber  " Disabled to match nixvim
set cursorcolumn
set signcolumn=yes
set list
set cmdheight=1
set laststatus=1
set showcmd
set ruler
set showtabline=1

" ============================================================================
" Search Settings
" ============================================================================
set hlsearch
set ignorecase
set smartcase
set incsearch

" ============================================================================
" Folding
" ============================================================================
set nofoldenable
set wrap

" ============================================================================
" Editing Behavior
" ============================================================================
set confirm
set hidden
set autoread
set autoindent
set smartindent

" ============================================================================
" Indentation
" ============================================================================
set tabstop=2
set softtabstop=2
set shiftwidth=2
set expandtab

" ============================================================================
" Completion and Menu
" ============================================================================
set wildmenu
set wildoptions=pum
set completeopt=menuone,noinsert

" ============================================================================
" Timing
" ============================================================================
set timeout
set timeoutlen=300

" ============================================================================
" Additional Settings
" ============================================================================
set helplang=en
set termguicolors
set clipboard=unnamed
set encoding=utf-8
set noswapfile
set nobackup
set undofile
set undodir=~/.vim/undo

" Create undo directory if it doesn't exist
if !isdirectory(expand('~/.vim/undo'))
  call mkdir(expand('~/.vim/undo'), 'p')
endif

" ============================================================================
" Key Mappings
" ============================================================================
inoremap jj <Esc>
