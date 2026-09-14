{
  delib,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nvf.ui";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = let
    noicePatched = pkgs.vimPlugins.noice-nvim.overrideAttrs (old: {
      pname = "noice-nvim";
      postPatch =
        (old.postPatch or "")
        + ''
          substituteInPlace lua/noice/view/backend/virtualtext.lua \
            --replace-fail 'virt_text_pos = "eol",' \
                           'virt_text_pos = self._opts.virt_text_pos or "eol",'
        '';
    });
  in {
    programs.nvf.settings.vim = {
      ui = {
        noice = {
          enable = true;
          setupOpts = {
            presets = {
              bottom_search = false;
              command_palette = true;
              inc_rename = true;
              long_message_to_split = true;
            };
            lsp = {
              progress.enabled = false;
              hover.enabled = false;
              signature.enabled = false;
              message.enabled = false;

              override = {
                "vim.lsp.util.convert_input_to_markdown_lines" = false;
                "vim.lsp.util.stylize_markdown" = false;
                "cmp.entry.get_documentation" = false;
              };
            };
            cmdline = {
              enabled = true;
              view = "cmdline_popup";
            };
            messages = {
              enabled = true;
              view_search = "virtualtext";
            };
            notify = {
              enabled = true;
              view = "notify";
            };
            views = {
              virtualtext = {
                backend = "virtualtext";
                format = ["{message}"];
                hl_group = "NoiceVirtualText";
                virt_text_pos = "eol_right_align";
              };
            };
          };
        };
      };
      extraPlugins.nvim-notify = {
        package = pkgs.vimPlugins.nvim-notify;
        # Do not assign vim.notify; Noice owns that and routes to this backend.
        setup = ''
          require("notify").setup({
            render = "default",
            timeout = 5000,
            top_down = true,
            stages = "fade_in_slide_out",
          })
        '';
      };
      lazy.plugins.noice-nvim.package = lib.mkForce noicePatched;
    };
  };
}
