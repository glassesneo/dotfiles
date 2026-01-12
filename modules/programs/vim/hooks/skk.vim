" Skkeleton configuration for Vim
" Translated from skk.lua hooks
" Note: <C-j> and <C-l> keymaps are defined in hook_add in skk.toml

" Configuration
call skkeleton#config({
  \ 'globalDictionaries': ['@skk-dict-path@'],
  \ 'eggLikeNewline': v:true,
  \ 'userDictionary': '~/.config/.skkeleton',
  \ })

" Custom key mappings
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
