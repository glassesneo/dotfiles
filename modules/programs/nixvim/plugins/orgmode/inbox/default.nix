{delib, ...}:
delib.module {
  name = "programs.nixvim.plugins.orgmode.inbox";

  # Optional child feature: disable independently while keeping the base
  # orgmode module active.
  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {parent, ...}: let
    inboxFile = "${parent.entrypoint}/inbox.org";
  in {
    programs.nixvim.plugins.orgmode.settings = {
      org_agenda_custom_commands = {};
      org_agenda_files = [inboxFile];
      org_default_notes_file = inboxFile;
      org_capture_templates = {
        i = {
          description = "Inbox";
          template = builtins.readFile ./templates/inbox.org;
          target = inboxFile;
        };
      };
    };
  };
}
