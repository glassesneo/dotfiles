{
  delib,
  homeConfig,
  ...
}: let
  gtd_dir = "${homeConfig.home.homeDirectory}/gtd";
in
  delib.module {
    name = "programs.nvf.orgmode.gtd";

    options = delib.singleCascadeEnableOption;

    home.ifEnabled = {
      programs.nvf.settings.vim = {
        notes.orgmode.setupOpts = let
          inbox_file = "${gtd_dir}/inbox.org";
        in {
          org_agenda_files = [
            inbox_file
            "${gtd_dir}/tasks.org"
            "${gtd_dir}/projects.org"
            "${gtd_dir}/habits.org"
          ];
          org_default_notes_file = inbox_file;
          org_capture_templates = {
            t = {
              description = "Inbox Todo";
              template = [
                "* TODO %?"
                ":PROPERTIES:"
                ":CREATED: %U"
                ":END:"
              ];
              target = inbox_file;
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
