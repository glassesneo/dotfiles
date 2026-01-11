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
    journalTemplate = "${orgfiles}/journal/%<%Y-%m>.org";
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
        org_todo_keywords = [
          "TODO"
          "NEXT"
          "WAIT"
          "|"
          "DONE"
          "CANCELLED"
        ];
        org_agenda_custom_commands = {
          i = {
            description = "Inbox";
            types = [
              {
                type = "tags";
                match = "LEVEL=1-DONE-CANCELLED";
                todo_only = false;
                org_agenda_overriding_header = "Inbox";
                org_agenda_files = ["${orgfiles}/inbox.org"];
              }
            ];
          };
          t = {
            description = "Todo";
            types = [
              {
                type = "tags_todo";
                match = "/+TODO|+NEXT|+WAIT";
                org_agenda_overriding_header = "Todo";
                org_agenda_files = ["${orgfiles}/inbox.org"];
              }
            ];
          };
          p = {
            description = "Project TODOs";
            types = [
              {
                type = "tags_todo";
                match = "/+TODO|+NEXT|+WAIT";
                org_agenda_overriding_header = "Projects";
                org_agenda_files = [
                  "${orgfiles}/inbox.org"
                  "${orgfiles}/projects/**/*"
                ];
              }
            ];
          };
          n = {
            description = "Next Actions";
            types = [
              {
                type = "tags_todo";
                match = "/+NEXT";
                org_agenda_overriding_header = "Next Actions";
                org_agenda_files = [
                  "${orgfiles}/inbox.org"
                  "${orgfiles}/projects/**/*"
                ];
              }
            ];
          };
          w = {
            description = "Waiting";
            types = [
              {
                type = "tags_todo";
                match = "/+WAIT";
                org_agenda_overriding_header = "Waiting";
                org_agenda_files = [
                  "${orgfiles}/inbox.org"
                  "${orgfiles}/projects/**/*"
                ];
              }
            ];
          };
          d = {
            description = "Deadlines (14d)";
            types = [
              {
                type = "agenda";
                org_agenda_deadline_warning_days = 14;
                org_agenda_files = [
                  "${orgfiles}/inbox.org"
                  "${orgfiles}/projects/**/*"
                ];
              }
            ];
          };
          O = {
            description = "Daily Overview";
            types = [
              {
                type = "agenda";
                org_agenda_span = "day";
                org_agenda_overriding_header = "Daily Overview";
                org_agenda_files = [
                  "${orgfiles}/inbox.org"
                  "${orgfiles}/projects/**/*"
                ];
              }
            ];
          };
          W = {
            description = "Weekly Overview";
            types = [
              {
                type = "agenda";
                org_agenda_span = "week";
                org_agenda_overriding_header = "Weekly Overview";
                org_agenda_files = [
                  "${orgfiles}/inbox.org"
                  "${orgfiles}/projects/**/*"
                ];
              }
              {
                type = "tags_todo";
                match = "/+TODO|+NEXT";
                org_agenda_overriding_header = "Unscheduled Actions";
                org_agenda_todo_ignore_scheduled = "all";
                org_agenda_todo_ignore_deadlines = "all";
                org_agenda_files = [
                  "${orgfiles}/inbox.org"
                  "${orgfiles}/projects/**/*"
                ];
              }
              {
                type = "tags_todo";
                match = "/+DONE";
                org_agenda_overriding_header = "Recently Completed";
                org_agenda_files = [
                  "${orgfiles}/inbox.org"
                  "${orgfiles}/projects/**/*"
                ];
              }
            ];
          };
          M = {
            description = "Monthly Overview";
            types = [
              {
                type = "agenda";
                org_agenda_span = "month";
                org_agenda_overriding_header = "Monthly Overview";
                org_agenda_files = [
                  "${orgfiles}/inbox.org"
                  "${orgfiles}/projects/**/*"
                ];
              }
            ];
          };
          Z = {
            description = "Zettelkasten Overview";
            types = [
              {
                type = "tags";
                match = "fleeting";
                org_agenda_overriding_header = "Fleeting Notes";
                org_agenda_files = [
                  "${orgfiles}/inbox.org"
                ];
              }
              {
                type = "tags";
                match = "literature";
                org_agenda_overriding_header = "Literature Notes";
                org_agenda_files = [
                  "${orgfiles}/zettelkasten/literature/**/*"
                ];
              }
              {
                type = "tags";
                match = "permanent";
                org_agenda_overriding_header = "Permanent Notes";
                org_agenda_files = [
                  "${orgfiles}/zettelkasten/knowledge/**/*"
                ];
              }
              {
                type = "tags";
                match = "structure";
                org_agenda_overriding_header = "Structure Notes";
                org_agenda_files = [
                  "${orgfiles}/zettelkasten/knowledge/**/*"
                ];
              }
              {
                type = "tags";
                match = "index";
                org_agenda_overriding_header = "Index Notes";
                org_agenda_files = [
                  "${orgfiles}/zettelkasten/knowledge/**/*"
                ];
              }
            ];
          };
          F = {
            description = "Zettelkasten | Fleeting Notes";
            types = [
              {
                type = "tags";
                match = "LEVEL=1+fleeting";
                org_agenda_overriding_header = "Fleeting Notes";
                org_agenda_files = [
                  "${orgfiles}/inbox.org"
                ];
              }
            ];
          };
          L = {
            description = "Zettelkasten | Literature Notes";
            types = [
              {
                type = "tags";
                match = "LEVEL=1+literature";
                org_agenda_overriding_header = "Literature Notes";
                org_agenda_files = [
                  "${orgfiles}/zettelkasten/literature/**/*"
                ];
              }
            ];
          };
          P = {
            description = "Zettelkasten | Permanent Notes";
            types = [
              {
                type = "tags";
                match = "LEVEL=1+permanent";
                org_agenda_overriding_header = "Permanent Notes";
                org_agenda_files = [
                  "${orgfiles}/zettelkasten/knowledge/**/*"
                ];
              }
            ];
          };
          S = {
            description = "Zettelkasten | Structure Notes";
            types = [
              {
                type = "tags";
                match = "LEVEL=1+structure";
                org_agenda_overriding_header = "Structure Notes";
                org_agenda_files = [
                  "${orgfiles}/zettelkasten/knowledge/**/*"
                ];
              }
            ];
          };
          I = {
            description = "Zettelkasten | Index Notes";
            types = [
              {
                type = "tags";
                match = "index";
                org_agenda_overriding_header = "Index Notes";
                org_agenda_files = [
                  "${orgfiles}/zettelkasten/knowledge/**/*"
                ];
              }
            ];
          };
        };
        org_capture_templates = {
          N = {
            description = "Inbox / Fleeting Note | Zettelkasten";
            template = ''
              * %?
                %u

            '';
          };
          n = {
            description = "Morning check-in | Daily journal";
            template = ''
              * Start
              :PROPERTIES:
              :FEELING: %^{FEELING|fresh|calm|sleepy|anxious|tired|restless}
              :MOOD: %^{MOOD|🙂|😀|🙂|😐|🙁|😫}
              :ENERGY: %^{ENERGY|⚡️⚡️|⚡️⚡️⚡️|⚡️⚡️|⚡️|🪫|🪫🪫}
              :END:
                [%<%H:%M>]
            '';
            target = journalTemplate;
            datetree = {
              tree_type = "day";
            };
          };
          d = {
            description = "Diary | Daily journal";
            template = ''
              * Diary
              :PROPERTIES:
              :FEELING: %^{FEELING|fresh|calm|sleepy|anxious|tired|restless}
              :MOOD: %^{MOOD|🙂|😀|🙂|😐|🙁|😫}
              :ENERGY: %^{ENERGY|⚡️⚡️|⚡️⚡️⚡️|⚡️⚡️|⚡️|🪫|🪫🪫}
              :END:
                [%<%H:%M>]

              - 今日の一行 :: %?
              - できたこと（最大3つ） ::
              - ひっかかったこと (できれば原因も) ::
                -
              - 明日の最初の一手 ::
                -

            '';
            target = journalTemplate;
            datetree = {
              tree_type = "day";
            };
          };
          r = {
            description = "Reflection | Daily journal";
            template = ''
              * Reflection
              :PROPERTIES:
              :REFLECT: %^{CARD|A 事実/解釈/感情|B 前提チェック|C 可能性|D 行動変換}
              :END:
                [%<%H:%M>]
              - トピック :: %^{TOPIC}
                -
              - 明日試す一手

            '';
            target = journalTemplate;
            datetree = {
              tree_type = "day";
            };
          };
        };
        mappings = {
          org = {
            org_open_at_point = false;
          };
          capture = {
            org_capture_kill = "<C-c>";
            org_capture_finalize = "<Space>w";
            org_capture_refile = "<C-r>";
            org_capture_show_help = "?";
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

    programs.nixvim.extraConfigLua = builtins.readFile ./orgmode.lua;

    home.packages = let
      org = pkgs.writeShellScriptBin "org" ''(cd ${orgfiles} && nvim .)'';
    in [org];
  };
}
