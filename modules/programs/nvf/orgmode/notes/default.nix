{delib, ...}:
delib.module {
  name = "programs.nvf.orgmode.notes";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {parent, ...}: let
    notes_dir = "${parent.org_directory}/notes";
    incubate_file = "${notes_dir}/incubate.org";
    notes_files = [
      incubate_file
    ];
  in {
    programs.nvf.settings.vim = {
      additionalRuntimePaths = [./runtime];

      notes.orgmode.setupOpts = {
        org_agenda_files = notes_files;

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

      pluginRC.orgmode-clear-todo-on-incubate-refile = {
        after = ["orgmode"];
        before = [];
        data = ''
          vim.api.nvim_create_autocmd("User", {
            pattern = "NvfOrgmodeLoaded",
            once = true,
            callback = function()
              require("nvf.orgmode.refile").setup({
                clear_todo_destinations = {
                  ${builtins.toJSON incubate_file},
                },
              })
            end,
          })
        '';
      };
    };
  };
}
