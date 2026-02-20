" Shared skkeleton core configuration for Vim/Neovim hooks
" Note: <C-j> and <C-l> keymaps are configured by each editor's plugin loader.

" hook_source {{{
call skkeleton#config({
  \ 'globalDictionaries': ['@skk-dict-path@'],
  \ 'eggLikeNewline': v:true,
  \ 'userDictionary': '~/.config/.skkeleton',
  \ })

call skkeleton#register_keymap('input', ':', 'henkanPoint')
call skkeleton#register_kanatable('rom', {
  \ 'l': v:false,
  \ 'la': ['ぁ'],
  \ 'li': ['ぃ'],
  \ 'lu': ['ぅ'],
  \ 'le': ['ぇ'],
  \ 'lo': ['ぉ'],
  \ 'lya': ['ゃ'],
  \ 'lyu': ['ゅ'],
  \ 'lyo': ['ょ'],
  \ })
" }}}
