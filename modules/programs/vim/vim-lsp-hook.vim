" TypeScript / JavaScript via vtsls
if executable('vtsls')
  au User lsp_setup call lsp#register_server({
    \ 'name': 'vtsls',
    \ 'cmd': {server_info->['vtsls', '--stdio']},
    \ 'allowlist': ['typescript', 'typescriptreact', 'javascript'],
    \ })
endif

" Nix via nil
if executable('nil')
  au User lsp_setup call lsp#register_server({
    \ 'name': 'nil',
    \ 'cmd': {server_info->['nil']},
    \ 'allowlist': ['nix'],
    \ })
endif
