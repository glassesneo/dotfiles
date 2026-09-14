{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.nvf.autocomplete";

  options = with delib;
    moduleOptions {
      default_sources = readOnly (listOfOption str [
        "buffer"
        "lsp"
        "cmdline"
      ]);
      source_priority = description (listOfOption str [
        "lsp"
        "snippets"
        "path"
        "orgmode"
        "cmdline"
        "buffer"
        "ripgrep"
      ]) "Keep-order for duplicate blink.cmp labels. Earlier entries win; source ids absent from this list lose to every listed source.";
    };

  home.ifEnabled = {cfg, ...}: {
    assertions = [
      {
        assertion = lib.length cfg.source_priority == lib.length (lib.unique cfg.source_priority);
        message = "myconfig.programs.nvf.autocomplete.source_priority must not contain duplicate source ids.";
      }
    ];

    programs.nvf.settings.vim.autocomplete.blink-cmp = {
      setupOpts.sources = {
        default = lib.mkForce [
          "buffer"
          "lsp"
          "cmdline"
          "path"
          "snippets"
          "ripgrep"
        ];
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
              # score_offset = 3;
            };
          };
          cmdline = {
            override.enabled = lib.generators.mkLuaInline ''
              function()
                local t = vim.fn.getcmdtype()
                return t == ':' or t == '@'
              end
            '';
            module = "blink.cmp.sources.cmdline";
          };
        };
      };
      sourcePlugins = {
        ripgrep = {
          enable = true;
        };
      };
    };
  };
}
