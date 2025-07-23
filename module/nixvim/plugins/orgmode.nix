{
  plugins = {
    orgmode = {
      enable = true;
      settings = {
        org_agenda_files = [
          "~/Documents/org/**/*.org"
        ];
        org_default_notes_file = "~/Documents/org/refile.org";
        # org_indent_mode = "indent";
        org_todo_keywords = [
          "TODO"
          "IN-PROGRESS"
          "CANCELLED"
          "DONE"
        ];
        # org_agenda_span = "day";
      };
    };
  };
}
