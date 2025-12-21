{
  delib,
  homeConfig,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.orgmode";

  options = delib.singleEnableOption true;

  home.ifEnabled = let
    orgfiles = "${homeConfig.home.homeDirectory}/orgfiles";
  in {
    programs.nixvim.plugins.orgmode = {
      enable = true;
      settings = rec {
        org_agenda_files = "${orgfiles}/**/*";
        org_default_notes_file = "${orgfiles}/refile.org";
        org_capture_templates = {
          t = {
            description = "Todo";
            template = "* TODO %?\n";
            target = org_default_notes_file;
          };
        };
        mappings = {};
        win_split_mode = "float";
        win_border = "rounded";
        ui = {
          input.use_vim_ui = true;
        };
      };
      lazyLoad = {
        enable = true;
        settings = {
          ft = ["org"];
          cmd = [
            "Org"
          ];
          keys = [
            {
              __unkeyed-1 = "<CR>c";
              mode = ["n"];
              __unkeyed-3 = "<Cmd>Org capture t<CR>";
            }
            {
              __unkeyed-1 = "<CR>a";
              mode = ["n"];
              __unkeyed-3 = "<Cmd>Org agenda t<CR>";
            }
          ];
        };
      };
    };

    home.packages = let
      org = pkgs.writeShellScriptBin "org" ''(cd ${orgfiles} && nvim .)'';
    in [org];
  };
}
