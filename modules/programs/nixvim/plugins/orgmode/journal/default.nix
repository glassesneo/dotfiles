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
    journalTemplate = "${journal}/%<%Y-%m>.org";
    journalFiles = ["${journal}/**/*.org"];
    dailyFiles = ["${journal}/daily/**/*.org"];

    mkTagsCmd = {
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
        C = mkTagsCmd {
          description = "Daily Check-in";
          match = "checkin";
          header = "Daily Check-in";
          files = journalFiles;
        };
        D = mkTagsCmd {
          description = "Diary Entries";
          match = "diary";
          header = "Diary Entries";
          files = journalFiles;
        };
        j = mkTagsCmd {
          description = "Daily Journal Files";
          match = "LEVEL=1";
          header = "Daily Journal Files";
          files = dailyFiles;
        };
      };
      org_capture_templates = {
        m = {
          description = "Morning check-in | Daily journal";
          template = builtins.readFile ./templates/morning-checkin.org;
          target = journalTemplate;
          datetree = {
            tree_type = "day";
          };
        };
        d = {
          description = "Diary | Daily journal";
          template = builtins.readFile ./templates/diary.org;
          target = journalTemplate;
          datetree = {
            tree_type = "day";
          };
        };
        r = {
          description = "Reflection | Daily journal";
          template = builtins.readFile ./templates/reflection.org;
          target = journalTemplate;
          datetree = {
            tree_type = "day";
          };
        };
      };
    };

    programs.nixvim.extraConfigLua = builtins.readFile (
      pkgs.replaceVars ./today.lua {
        journal-path = journal;
      }
    );

    home.packages = let
      checkin = pkgs.writeShellScriptBin "checkin" "nvim -c 'Org capture m'";
      diary = pkgs.writeShellScriptBin "diary" "nvim -c 'Org capture d'";
      today = pkgs.writeShellScriptBin "today" "nvim -c 'Today'";
    in [
      checkin
      diary
      today
    ];
  };
}
