{
  delib,
  homeConfig,
  ...
}: let
  inbox_file = "${homeConfig.home.homeDirectory}/org/inbox.org";
  gtd_dir = "${homeConfig.home.homeDirectory}/org/gtd";
  tasks_file = "${gtd_dir}/tasks.org";
  projects_file = "${gtd_dir}/projects.org";
  habits_file = "${gtd_dir}/habits.org";
  dates_file = "${gtd_dir}/dates.org";
  gtd_files = [
    tasks_file
    projects_file
    habits_file
    dates_file
  ];
in
  delib.module {
    name = "programs.nvf.orgmode.gtd";

    options = with delib;
      moduleOptions ({parent, ...}: {
        enable = boolOption parent.enable;
        org_todo_keywords = readOnly (listOfOption str [
          "TODO"
          "NEXT"
          "WAIT"
          "|"
          "DONE"
          "CANCELLED"
        ]);
      });

    home.ifEnabled = {cfg, ...}: {
      programs.nvf.settings.vim = {
        notes.orgmode.setupOpts = let
          allTodoStates =
            builtins.filter
            (keyword: keyword != "|")
            cfg.org_todo_keywords;

          nonTodoMatch =
            "LEVEL=1/!-"
            + builtins.concatStringsSep "-" allTodoStates;
        in {
          org_agenda_files = gtd_files;
          inherit (cfg) org_todo_keywords;
          org_capture_templates = {
            c = {
              description = "Just a capture";
              template = [
                "* %?"
                ":PROPERTIES:"
                ":CREATED: %U"
                ":END:"
              ];
              target = inbox_file;
            };

            t = {
              description = "Todo capture";
              template = [
                "* TODO %?"
                ":PROPERTIES:"
                ":CREATED: %U"
                ":END:"
              ];
              target = inbox_file;
            };
            d = {
              description = "Date event capture";
              template = [
                "* %?"
                ":PROPERTIES:"
                ":CREATED: %U"
                ":END:"
              ];
              target = dates_file;
            };
          };

          org_agenda_custom_commands = {
            u = {
              description = "Inbox processing";
              types = [
                {
                  type = "tags_todo";
                  match = "LEVEL=1";
                  org_agenda_files = [inbox_file];
                  org_agenda_overriding_header = "Unprocessed todo";
                  org_agenda_sorting_strategy = [
                    "todo-state-up"
                    "priority-down"
                  ];
                }
                {
                  type = "tags";
                  match = nonTodoMatch;
                  org_agenda_files = [inbox_file];
                  org_agenda_overriding_header = "Non-todo captures";
                }
              ];
            };
            t = {
              description = "Tasks";
              types = [
                {
                  type = "tags_todo";
                  match = "LEVEL>=1";
                  org_agenda_files = [
                    tasks_file
                    projects_file
                    habits_file
                  ];
                  org_agenda_overriding_header = "Managed tasks";
                  org_agenda_sorting_strategy = [
                    "todo-state-up"
                    "priority-down"
                  ];
                }
              ];
            };
            d = {
              description = "Date overview";
              types = [
                {
                  type = "agenda";
                  org_agenda_files = [
                    inbox_file
                    tasks_file
                    projects_file
                    dates_file
                    habits_file
                  ];
                  org_agenda_overriding_header = "Upcoming dates";
                  org_agenda_span = 30;
                  org_agenda_start_on_weekday = false;
                }
              ];
            };
          };
          org_todo_repeat_to_state = "TODO";

          org_log_done = "time";
          org_log_repeat = "time";
          org_log_into_drawer = "LOGBOOK";

          org_archive_location = "%s_archive::";

          org_deadline_warning_days = 7;

          org_agenda_span = "day";
          org_agenda_start_on_weekday = 1;

          org_agenda_skip_scheduled_if_done = true;
          org_agenda_skip_deadline_if_done = true;
        };
      };
    };
  }
