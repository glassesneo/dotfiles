" Vim dpp.vim setup script
" Translated from setup-dpp.lua for Vim compatibility

let s:dpp_base = $XDG_CACHE_HOME . '/vim-dpp'
let s:dpp_config = $XDG_CONFIG_HOME . '/vim-dpp/dpp.ts'

" Use dpp#min#load_state() - minimal loader available immediately
if dpp#min#load_state(s:dpp_base)
  " Failed to load state, regenerate on DenopsReady
  autocmd User DenopsReady call dpp#make_state(s:dpp_base, s:dpp_config)
endif

autocmd User Dpp:makeStatePost echomsg 'dpp make_state() is done'

" Define dpp commands
command! DppInstall call dpp#async_ext_action('installer', 'install')
command! -nargs=* DppUpdate call dpp#async_ext_action('installer', 'update', {'names': [<f-args>]})
command! DppCheckUpdate call dpp#async_ext_action('installer', 'checkNotUpdated')
command! DppClearState call dpp#clear_state()
