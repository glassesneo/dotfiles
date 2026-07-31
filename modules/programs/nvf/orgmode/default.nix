{
  delib,
  homeConfig,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nvf.orgmode";

  options = with delib;
    moduleOptions ({parent, ...}: {
      enable = boolOption parent.enable;
      org_directory = readOnly (strOption "${homeConfig.home.homeDirectory}/org");
    });

  home.ifEnabled = {
    myconfig,
    cfg,
    ...
  }: {
    programs.nvf.settings.vim = {
      additionalRuntimePaths = [
        "${pkgs.lua51Packages.tree-sitter-orgmode}/lib/lua/5.1"
      ];

      notes.orgmode = {
        enable = true;
        treesitter.enable = false;
        setupOpts = let
          inbox_file = "${cfg.org_directory}/inbox.org";
        in {
          org_agenda_files = [
            inbox_file
          ];
          org_default_notes_file = inbox_file;
          org_startup_indented = true;
          org_id_link_to_org_use_id = true;
          org_id_method = "uuid";
          org_agenda_show_future_repeats = "next";
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
