{
  delib,
  homeConfig,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.orgmode";

  options = with delib;
    moduleOptions {
      # Base owner for orgmode. Optional workflows such as inbox and journal
      # hang off this namespace as child modules and inherit shared state.
      enable = boolOption true;
      entrypoint = strOption "${homeConfig.home.homeDirectory}/brain";
    };

  home.ifEnabled = {cfg, ...}: let
    inherit (cfg) entrypoint;
  in {
    programs.nixvim.plugins.orgmode = {
      enable = true;
      settings = {
        org_archive_location = "${entrypoint}/archive/%s_archive::";
        org_todo_keywords = [
          "TODO"
          "NEXT"
          "WAIT"
          "|"
          "DONE"
          "CANCELLED"
        ];
        org_adapt_indentation = false;
        org_startup_indented = true;
        mappings = {
          org_return_uses_meta_return = false;
          org = {
            org_open_at_point = false;
            org_return = false;
          };
          capture = {
            org_capture_kill = "<C-c>";
            org_capture_finalize = "<Space>w";
            org_capture_refile = "<C-r>";
            org_capture_show_help = "?";
          };
        };
        win_split_mode = "tabnew";
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
              __unkeyed-3 = "<Cmd>Org capture<CR>";
            }
            {
              __unkeyed-1 = "<CR>a";
              mode = ["n"];
              __unkeyed-3 = "<Cmd>Org agenda<CR>";
            }
            {
              __unkeyed-1 = "gf";
              mode = ["n"];
              __unkeyed-3.__raw = ''
                function()
                  if vim.bo.filetype == "org" then
                    require('orgmode').action('org_mappings.open_at_point')
                    return
                  end
                  vim.cmd("normal! gf")
                end
              '';
            }
          ];
        };
      };
    };

    programs.nixvim.autoCmd = [
      {
        event = ["FileType"];
        pattern = ["org"];
        callback.__raw = ''
          function()
            vim.keymap.set(
              'i',
              '<S-CR>',
              '<cmd>lua require("orgmode").action("org_mappings.meta_return")<CR>',
              {
                silent = true,
                buffer = true,
                desc = 'Org meta return',
              }
            )
          end
        '';
      }
    ];

    home.packages = let
      org = pkgs.writeShellScriptBin "org" ''(cd ${entrypoint} && nvim .)'';
    in [
      org
    ];
  };
}
