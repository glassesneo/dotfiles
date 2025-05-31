{
  plugins = {
    orgmode = {
      enable = true;
      settings = {
        org_agenda_files = [
          "~/org/agenda/*"
          "~/org/notes/*"
        ];
        org_default_notes_file = "~/org/notes/refile.org";
        org_indent_mode = "indent";
        org_startup_folded = "content";
        # org_todo_keywords = [
        # "TODO"
        # "IN-PROGRESS"
        # "DONE"
        # ];
        # org_agenda_span = "day";
      };
    };
  };
}
