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
        # Language modules own formatter selection. This module owns only the
        # Conform engine and save policy; unavailable project commands are no-ops.
        default_format_opts.lsp_format = "never";
        format_on_save = lib.generators.mkLuaInline (lib.removePrefix "return " (builtins.readFile ./format-on-save.lua));
        format_after_save = null;
      };
    };
  };
}
