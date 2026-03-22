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
    readLaterFile = "${orgfiles}/inbox.org";

    # --- Shared file lists ---
    inboxOnly = ["${orgfiles}/inbox.org"];
    allFiles = ["${orgfiles}/inbox.org" "${orgfiles}/projects/**/*"];
    zettelLitFiles = ["${orgfiles}/zettelkasten/literature/**/*"];
    zettelKnowFiles = ["${orgfiles}/zettelkasten/knowledge/**/*"];

    # --- Agenda command constructors ---
    # Single tags query (non-todo).
    mkTagsCmd = {
      description,
      match,
      header,
      files,
      extra ? {},
    }: {
      inherit description;
      types = [
        (
          {
            type = "tags";
            inherit match;
            todo_only = false;
            org_agenda_overriding_header = header;
            org_agenda_files = files;
          }
          // extra
        )
      ];
    };

    # Single tags_todo query with LEVEL=1 default.
    mkTodoCmd = {
      description,
      header,
      files,
      match ? "LEVEL=1",
      extra ? {},
    }: {
      inherit description;
      types = [
        (
          {
            type = "tags_todo";
            inherit match;
            org_agenda_overriding_header = header;
            org_agenda_files = files;
          }
          // extra
        )
      ];
    };

    # Single agenda query with optional span.
    mkAgendaCmd = {
      description,
      header,
      files,
      extra ? {},
    }: {
      inherit description;
      types = [
        (
          {
            type = "agenda";
            org_agenda_overriding_header = header;
            org_agenda_files = files;
          }
          // extra
        )
      ];
    };
  in {
    programs.nixvim.plugins.orgmode = {
      enable = true;
      settings = {
        org_agenda_files = allFiles;
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
          # --- GTD views ---
          i = mkTagsCmd {
            description = "Inbox";
            match = "LEVEL=1";
            header = "Inbox";
            files = inboxOnly;
          };
          t = mkTodoCmd {
            description = "Todo";
            header = "Todo";
            files = inboxOnly;
          };
          p = mkTodoCmd {
            description = "Project TODOs";
            header = "Projects";
            files = allFiles;
          };
          n = mkTodoCmd {
            description = "Next Actions";
            header = "Next Actions";
            files = allFiles;
          };
          w = mkTodoCmd {
            description = "Waiting";
            header = "Waiting";
            files = allFiles;
          };
          d = mkAgendaCmd {
            description = "Deadlines (14d)";
            header = "Deadlines (14d)";
            files = allFiles;
            extra.org_agenda_deadline_warning_days = 14;
          };
          R = {
            description = "Read later";
            types = [
              {
                type = "tags_todo";
                match = "readlater";
                org_agenda_overriding_header = "Read later";
                org_agenda_files = [readLaterFile];
              }
            ];
          };

          # --- Time-span overviews ---
          O = mkAgendaCmd {
            description = "Daily Overview";
            header = "Daily Overview";
            files = allFiles;
            extra.org_agenda_span = "day";
          };
          W = {
            description = "Weekly Overview";
            types = [
              {
                type = "agenda";
                org_agenda_span = "week";
                org_agenda_overriding_header = "Weekly Overview";
                org_agenda_files = allFiles;
              }
              {
                type = "tags_todo";
                match = "LEVEL=1";
                org_agenda_overriding_header = "Unscheduled Actions";
                org_agenda_todo_ignore_scheduled = "all";
                org_agenda_todo_ignore_deadlines = "all";
                org_agenda_files = allFiles;
              }
              {
                type = "tags_todo";
                match = "LEVEL=1";
                org_agenda_overriding_header = "Recently Completed";
                org_agenda_files = allFiles;
              }
            ];
          };
          M = mkAgendaCmd {
            description = "Monthly Overview";
            header = "Monthly Overview";
            files = allFiles;
            extra.org_agenda_span = "month";
          };

          # --- Zettelkasten views ---
          Z = {
            description = "Zettelkasten Overview";
            types = [
              {
                type = "tags";
                match = "LEVEL=1";
                todo_only = false;
                org_agenda_overriding_header = "Fleeting Notes";
                org_agenda_files = inboxOnly;
              }
              {
                type = "tags";
                match = "LEVEL=1+literature";
                todo_only = false;
                org_agenda_overriding_header = "Literature Notes";
                org_agenda_files = zettelLitFiles;
              }
              {
                type = "tags";
                match = "LEVEL=1+permanent";
                todo_only = false;
                org_agenda_overriding_header = "Permanent Notes";
                org_agenda_files = zettelKnowFiles;
              }
              {
                type = "tags";
                match = "LEVEL=1+structure";
                todo_only = false;
                org_agenda_overriding_header = "Structure Notes";
                org_agenda_files = zettelKnowFiles;
              }
              {
                type = "tags";
                match = "LEVEL=1+index";
                todo_only = false;
                org_agenda_overriding_header = "Index Notes";
                org_agenda_files = zettelKnowFiles;
              }
            ];
          };
          F = mkTagsCmd {
            description = "Zettelkasten | Fleeting Notes";
            match = "LEVEL=1";
            header = "Fleeting Notes";
            files = inboxOnly;
          };
          L = mkTagsCmd {
            description = "Zettelkasten | Literature Notes";
            match = "LEVEL=1+literature";
            header = "Literature Notes";
            files = zettelLitFiles;
          };
          P = mkTagsCmd {
            description = "Zettelkasten | Permanent Notes";
            match = "LEVEL=1+permanent";
            header = "Permanent Notes";
            files = zettelKnowFiles;
          };
          S = mkTagsCmd {
            description = "Zettelkasten | Structure Notes";
            match = "LEVEL=1+structure";
            header = "Structure Notes";
            files = zettelKnowFiles;
          };
          I = mkTagsCmd {
            description = "Zettelkasten | Index Notes";
            match = "LEVEL=1+index";
            header = "Index Notes";
            files = zettelKnowFiles;
          };
        };
        org_capture_templates = {
          N = {
            description = "Inbox / Fleeting Note | Zettelkasten";
            template = builtins.readFile ./templates/inbox.org;
          };
          w = {
            description = "Weekly report | Reflection";
            template = builtins.readFile ./templates/weekly.org;
            target = "${orgfiles}/weekly.org";
          };
          R = {
            description = "Read later";
            template = builtins.readFile ./templates/read-later.org;
            target = readLaterFile;
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
              __unkeyed-3.__raw = builtins.readFile ./callbacks.lua;
            }
          ];
        };
      };
    };

    programs.nixvim.extraConfigLua = builtins.readFile ./orgmode.lua;

    home.packages = let
      org = pkgs.writeShellScriptBin "org" ''(cd ${orgfiles} && nvim .)'';
    in [
      org
    ];
  };
}
