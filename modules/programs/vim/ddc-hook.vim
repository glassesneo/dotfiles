" Bootstrap ddc.vim with TypeScript config
" hook_source {{{
call ddc#custom#load_config($XDG_CONFIG_HOME . '/vim-dpp/ddc.ts')
call ddc#enable()

" pum.vim keybindings (don't override <CR>)
inoremap <C-n> <Cmd>call pum#map#insert_relative(+1)<CR>
inoremap <C-p> <Cmd>call pum#map#insert_relative(-1)<CR>
inoremap <C-y> <Cmd>call pum#map#confirm()<CR>
inoremap <C-e> <Cmd>call pum#map#cancel()<CR>
" }}}
