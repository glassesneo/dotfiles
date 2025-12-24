{
  delib,
  homeConfig,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.orgmode";

  options = delib.singleEnableOption true;

  home.ifEnabled = let
    orgfiles = "${homeConfig.home.homeDirectory}/orgfiles";
    journal = "${orgfiles}/journal/%<%Y-%m-%d>.org";
  in {
    programs.nixvim.plugins.orgmode = {
      enable = true;
      settings = {
        org_agenda_files = [
          "${orgfiles}/inbox.org"
          "${orgfiles}/projects/**/*"
        ];
        org_default_notes_file = "${orgfiles}/inbox.org";
        org_archive_location = "${orgfiles}/archive/%s_archive::";
        org_capture_templates = {
          t = {
            description = "Todo tasks";
            template = ''
              * TODO %^{Title}
              %u %?
            '';
          };
          f = {
            description = "Fleeting Note / Zettelkasten";
            template = ''
              * %^{Title}
              :PROPERTIES:
              :CAPTURED: %U
              :END:

              %?
            '';
            target = "${orgfiles}/zettelkasten/fleeting.org";
          };
          j = {
            description = "New Journal / Daily journal";
            template = ''
              * Log
              ** %T %?
            '';
            target = journal;
          };

          n = {
            description = "Append log / Daily journal";
            template = ''
              ** %T %^{Title}
              %?
            '';
            target = journal;
            headline = "Log";
          };
        };
        mappings = {
          org = {
            org_open_at_point = false;
          };
        };
        win_split_mode = "tabnew";
        ui = {
          input.use_vim_ui = true;
        };
      };
      lazyLoad = {
        enable = true;
        settings = let
          org-action = action: "require('orgmode').action('${action}')";
        in {
          ft = ["org"];
          cmd = [
            "Org"
          ];
          keys = [
            {
              __unkeyed-1 = "<CR>c";
              mode = ["n"];
              __unkeyed-3 = "<Cmd>Org capture<CR>";
            }
            {
              __unkeyed-1 = "<CR>a";
              mode = ["n"];
              __unkeyed-3 = "<Cmd>Org agenda<CR>";
            }
            {
              __unkeyed-1 = "gf";
              mode = ["n"];
              # __unkeyed-3 = "<Cmd>lua ${org-action "org_mappings.open_at_point"}<CR>";
              __unkeyed-3.__raw = ''
                function()
                  if vim.bo.filetype == "org" then
                    ${org-action "org_mappings.open_at_point"}
                    return
                  end
                  vim.cmd("normal! gf")
                end
              '';
            }
          ];
        };
      };
    };

    home.packages = let
      org = pkgs.writeShellScriptBin "org" ''(cd ${orgfiles} && nvim .)'';
    in [org];
  };
}
