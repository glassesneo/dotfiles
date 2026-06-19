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
            cmdline = {
              enabled = true;
              view = "cmdline_popup";
            };
            messages = {
              enabled = true;
              view_search = "virtualtext";
            };
            views = {
              virtualtext = {
                backend = "virtualtext";
                format = ["{message}"];
                hl_group = "NoiceVirtualText";
                virt_text_pos = "right_align";
              };
            };
          };
        };
      };
      lazy.plugins.noice-nvim.package = lib.mkForce noicePatched;
    };
  };
}
