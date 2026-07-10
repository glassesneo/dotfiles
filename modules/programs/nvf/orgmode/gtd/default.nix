{
  delib,
  homeConfig,
  ...
}: let
  inbox_file = "${homeConfig.home.homeDirectory}/org/inbox.org";
  gtd_dir = "${homeConfig.home.homeDirectory}/org/gtd";
  gtd_files = [
    "${gtd_dir}/tasks.org"
    "${gtd_dir}/projects.org"
    "${gtd_dir}/habits.org"
  ];
in
  delib.module {
    name = "programs.nvf.orgmode.gtd";

    options = delib.singleCascadeEnableOption;

    home.ifEnabled = {
      programs.nvf.settings.vim = {
        notes.orgmode.setupOpts = {
          org_agenda_files = gtd_files;
          org_capture_templates = {
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
          };

          org_agenda_custom_commands = {
            t = {
              description = "GTD todos";
              types = [
                {
                  type = "tags_todo";
                  match = ''TODO="TODO"|TODO="NEXT"'';
                  org_agenda_files = [inbox_file] ++ gtd_files;
                  org_agenda_overriding_header = "Todo List";
                  org_agenda_sorting_strategy = [
                    "todo-state-up"
                    "priority-down"
                  ];
                }
              ];
            };
          };
          org_todo_keywords = [
            "TODO"
            "NEXT"
            "WAIT"
            "|"
            "DONE"
            "CANCEL"
          ];
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
