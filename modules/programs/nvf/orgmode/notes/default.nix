{
  delib,
  homeConfig,
  ...
}: let
  inbox_file = "${homeConfig.home.homeDirectory}/org/inbox.org";
  notes_dir = "${homeConfig.home.homeDirectory}/org/notes";
  incubate_file = "${notes_dir}/incubate.org";
  notes_files = [
    incubate_file
  ];
in
  delib.module {
    name = "programs.nvf.orgmode.notes";

    options = delib.singleCascadeEnableOption;

    home.ifEnabled = {
      programs.nvf.settings.vim = {
        notes.orgmode.setupOpts = {
          org_agenda_files = notes_files;

          org_capture_templates = {
            i = {
              description = "Idea capture";
              template = [
                "* %?"
                ":PROPERTIES:"
                ":CREATED: %U"
                ":END:"
              ];
              target = inbox_file;
            };
          };

          org_agenda_custom_commands = {
            i = {
              description = "Idea review";
              types = [
                {
                  type = "tags";
                  match = "LEVEL=1";
                  org_agenda_files = [incubate_file];
                  org_agenda_overriding_header = "Incubating ideas";
                }
              ];
            };
          };
        };
      };
    };
  }
