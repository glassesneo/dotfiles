{
  delib,
  homeConfig,
  pkgs,
  ...
}: let
  inbox_file = "${homeConfig.home.homeDirectory}/org/inbox.org";
in
  delib.module {
    name = "programs.nvf.orgmode";

    options = delib.singleCascadeEnableOption;

    home.ifEnabled = {myconfig, ...}: {
      programs.nvf.settings.vim = {
        additionalRuntimePaths = [
          "${pkgs.lua51Packages.tree-sitter-orgmode}/lib/lua/5.1"
        ];

        notes.orgmode = {
          enable = true;
          treesitter.enable = true;
          setupOpts = {
            org_agenda_files = [
              inbox_file
            ];
            org_default_notes_file = inbox_file;
            org_startup_indented = true;
            win_split_mode = ["float" 0.7];
            win_border = "rounded";
            ui = {
              input = {
                use_vim_ui = true;
              };
            };
          };
        };

        autocomplete.blink-cmp.setupOpts.sources = {
          per_filetype.org = ["orgmode"] ++ myconfig.programs.nvf.autocomplete.default_sources;
          providers = {
            orgmode = {
              name = "Orgmode";
              module = "orgmode.org.autocompletion.blink";
              fallbacks = [
                "buffer"
              ];
            };
          };
        };
      };
    };
  }
