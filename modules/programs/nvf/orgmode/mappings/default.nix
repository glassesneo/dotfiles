{delib, ...}:
delib.module {
  name = "programs.nvf.orgmode.mappings";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.nvf.settings.vim = {
      notes.orgmode.setupOpts = {
        mappings = {
          org_return_uses_meta_return = false;
          prefix = "<C-c>";

          global = {
            # Common Emacs Org custom bindings
            org_agenda = "<C-c>a";
            org_capture = "<C-c>c";
          };

          capture = {
            # Emacs org-capture
            org_capture_finalize = "<C-c><C-c>";
            org_capture_refile = "<C-c><C-w>";
            org_capture_kill = "<C-c><C-k>";
            org_capture_show_help = "g?";
          };

          note = {
            org_note_finalize = "<C-c><C-c>";
            org_note_kill = "<C-c><C-k>";
          };

          org = {
            # Core GTD operations
            org_todo = "<C-c><C-t>";
            org_refile = "<C-c><C-w>";
            org_schedule = "<C-c><C-s>";
            org_deadline = "<C-c><C-d>";
            org_archive_subtree = "<C-c><C-x><C-s>";

            # Timestamps
            org_time_stamp = "<C-c>.";
            org_time_stamp_inactive = "<C-c>!";
            org_toggle_timestamp_type = "<C-c><C-x><C-t>";

            # Tags / priority
            org_set_tags_command = "<C-c><C-q>";
            org_priority = "<C-c>,";

            # Links
            org_open_at_point = "<C-c><C-o>";
            org_store_link = "<C-c>l";
            org_insert_link = "<C-c><C-l>";

            # Checkboxes / context action
            org_toggle_checkbox = "<C-c><C-c>";

            org_next_visible_heading = "}";
            org_previous_visible_heading = "{";
            org_forward_heading_same_level = "]]";
            org_backward_heading_same_level = "[[";
            outline_up_heading = "g{";
            org_return = false;

            org_show_help = "g?";
          };

          agenda = {
            # Agenda navigation
            org_agenda_later = "f";
            org_agenda_earlier = "b";
            org_agenda_goto_today = ".";
            org_agenda_day_view = "vd";
            org_agenda_week_view = "vw";
            org_agenda_month_view = "vm";
            org_agenda_year_view = "vy";

            org_agenda_quit = "q";
            org_agenda_switch_to = "<CR>";
            org_agenda_goto = "<TAB>";
            org_agenda_goto_date = "J";

            # Emacs agenda is closer to g for refresh.
            org_agenda_redo = "g";

            # GTD operations from agenda
            org_agenda_todo = "t";
            org_agenda_refile = "<C-c><C-w>";
            org_agenda_schedule = "<C-c><C-s>";
            org_agenda_deadline = "<C-c><C-d>";
            org_agenda_archive = "<C-c><C-x><C-s>";
            org_agenda_set_tags = "<C-c><C-q>";
            org_agenda_priority = "<C-c>,";

            org_agenda_filter = "/";
            org_agenda_show_help = "g?";
          };
        };
      };
    };
  };
}
