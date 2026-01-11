" Skkeleton configuration for Vim
" Translated from skk.lua hooks
" Note: <C-j> keymaps are defined in hook_add in skk.toml

" Configuration
call skkeleton#config({
  \ 'globalDictionaries': ['@skk-dict-path@'],
  \ 'eggLikeNewline': v:true,
  \ 'userDictionary': '~/.config/.skkeleton',
  \ })

" Pre-enable hook for disable keymap
autocmd User skkeleton-enable-pre call s:skkeleton_pre_enable()
function! s:skkeleton_pre_enable()
  imap <C-l> <Plug>(skkeleton-disable)
  cmap <C-l> <Plug>(skkeleton-disable)
endfunction

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
