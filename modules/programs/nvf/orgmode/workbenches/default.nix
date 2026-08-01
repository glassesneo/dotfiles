{delib, ...}:
delib.module {
  name = "programs.nvf.orgmode.workbenches";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {parent, ...}: let
    workbenches_dir = "${parent.org_directory}/workbenches";
    workbenches_files = [
      "${workbenches_dir}/*.org"
    ];
  in {
    programs.nvf.settings.vim = {
      notes.orgmode.setupOpts = {
        org_agenda_files = workbenches_files;
      };
    };
  };
}
