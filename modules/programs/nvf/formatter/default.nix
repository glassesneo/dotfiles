{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.nvf.formatter";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nvf.settings.vim = {
    globals.formatsave = true;
    formatter.conform-nvim = {
      enable = true;
      setupOpts = {
        # External formatters remain bare commands supplied by project devShells.
        # Conform's availability check and format-on-save callback make a missing
        # command a no-op rather than a failed editor session.
        formatters = {
          ruff_format.command = "ruff";
          biome.command = "biome";
          swift_format.command = "swift-format";
        };
        formatters_by_ft = {
          sh = ["shfmt"];
          bash = ["shfmt"];
          elm = ["elm_format"];
          haskell = ["fourmolu"];
          lhaskell = ["fourmolu"];
          kotlin = ["ktlint"];
          typst = ["typstyle"];
          python = ["ruff_format"];
          go = lib.generators.mkLuaInline ''{ "goimports", "gofmt", stop_after_first = true }'';
          swift = ["swift_format"];
          javascript = lib.generators.mkLuaInline "function(bufnr) return _G.nvf_web_formatters(bufnr) end";
          javascriptreact = lib.generators.mkLuaInline "function(bufnr) return _G.nvf_web_formatters(bufnr) end";
          typescript = lib.generators.mkLuaInline "function(bufnr) return _G.nvf_web_formatters(bufnr) end";
          typescriptreact = lib.generators.mkLuaInline "function(bufnr) return _G.nvf_web_formatters(bufnr) end";
        };
        default_format_opts.lsp_format = "never";
        format_on_save = lib.generators.mkLuaInline (lib.removePrefix "return " (builtins.readFile ./format-on-save.lua));
        format_after_save = null;
      };
    };
  };
}
