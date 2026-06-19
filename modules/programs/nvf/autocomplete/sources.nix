{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.nvf.autocomplete";

  home.ifEnabled.programs.nvf.settings.vim.autocomplete.blink-cmp = {
    setupOpts = {
      sources = {
        providers = {
          buffer = {
            override.enabled = lib.generators.mkLuaInline ''
              function()
                local t = vim.fn.getcmdtype()

                if vim.api.nvim_get_mode().mode == 'c' then
                  return t == '/' or t == '?'
                end

                return true
              end
            '';
            opts = {
              get_search_bufnrs = lib.generators.mkLuaInline ''
                function()
                  return { vim.api.nvim_get_current_buf() }
                end
              '';
            };
            module = "blink.cmp.sources.buffer";
          };
          lsp = {
            opts = {
              score_offset = 3;
            };
          };
          cmdline = {
            override.enabled = lib.generators.mkLuaInline ''
              function()
                return vim.fn.getcmdtype() == ':'
              end
            '';
            module = "blink.cmp.sources.cmdline";
          };
        };
      };
    };
    sourcePlugins = {
      ripgrep = {
        enable = true;
      };
    };
  };
}
