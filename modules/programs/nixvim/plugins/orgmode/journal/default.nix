{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.orgmode.journal";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {parent, ...}: let
    journal = "${parent.entrypoint}/journal";
    flatDailyFiles = ["${journal}/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].org"];

    mkAgendaCmd = {
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
  in {
    programs.nixvim.plugins.orgmode.settings = {
      org_agenda_custom_commands = {
        j = mkAgendaCmd {
          description = "Journal Sections";
          match = "LEVEL=2";
          header = "Journal Sections";
          files = flatDailyFiles;
        };
      };
    };

    programs.nixvim.extraConfigLua = builtins.readFile (
      pkgs.replaceVars ./today.lua {
        journal-path = journal;
      }
    );

    home.packages = let
      today = pkgs.writeShellScriptBin "today" "nvim -c 'Today'";
    in [
      today
    ];
  };
}
