{delib, ...}:
delib.module {
  name = "programs.nvf.orgmode.journal";

  options = delib.singleCascadeEnableOption;

  myconfig.always = {
    cfg,
    parent,
    ...
  }: {
    args.shared.orgmodeJournal = {
      enabled = cfg.enable;
      dailyFile = "${parent.org_directory}/journal/daily.org";
    };
  };

  home.ifEnabled = {parent, ...}: let
    journal_dir = "${parent.org_directory}/journal";
    daily_file = "${journal_dir}/daily.org";
    weekly_file = "${journal_dir}/weekly.org";
  in {
    programs.nvf.settings.vim = {
      additionalRuntimePaths = [./runtime];

      notes.orgmode.setupOpts = {
        org_agenda_files = [daily_file];

        org_capture_templates.j = {
          description = "Journal";
          subtemplates = {
            d = {
              description = "Daily Journal";
              target = daily_file;
              datetree = {
                tree_type = "day";
                reversed = true;
              };
              template = [
                "* Journal"
                "** Events"
                "- %?"
                "** Reflection"
                "** Weekly Goal Signal"
                "** Tomorrow"
                "*** NEXT"
                "SCHEDULED: %(return require(\"nvf.orgmode.journal\").tomorrow_timestamp())"
              ];
            };

            w = {
              description = "Weekly Review";
              target = weekly_file;
              datetree = {
                tree_type = "custom";
                reversed = true;
                tree = [
                  {
                    format = "%G";
                    pattern = "^(%d%d%d%d)$";
                    order = [1];
                  }
                  {
                    format = "%G-W%V";
                    pattern = "^(%d%d%d%d)%-W(%d%d)$";
                    order = [1 2];
                  }
                ];
              };
              template = [
                "* Review"
                ":PROPERTIES:"
                ":DAILY: [[file:daily.org][Daily Journal]]"
                ":PREVIOUS_WEEK: [[file:weekly.org::*%(return require(\"nvf.orgmode.journal\").previous_week_heading())][Previous Weekly Review]]"
                ":END:"
                ""
                "** Score Review"
                "- High :: %?"
                "- Low ::"
                "- Unexpected ::"
                ""
                "** Patterns"
                "- Repeated ::"
                "- Changed or learned ::"
                ""
                "** Goal Review"
                "- Goal ::"
                "- Review ::"
                "- Judgment ::"
                ""
                "** Next Goals"
                "-"
              ];
            };
          };
        };
      };
    };
  };
}
