{
  delib,
  homeConfig,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nvf.orgmode";

  options = with delib;
    moduleOptions ({parent, ...}: {
      enable = boolOption parent.enable;
      org_directory = readOnly (strOption "${homeConfig.home.homeDirectory}/org");
    });

  home.ifEnabled = {
    myconfig,
    cfg,
    ...
  }: {
    programs.nvf.settings.vim = {
      additionalRuntimePaths = [
        "${pkgs.lua51Packages.tree-sitter-orgmode}/lib/lua/5.1"
      ];

      pluginRC = lib.mkMerge [
        {
          orgmode = {
            before = [];
            after = [];
            data = lib.mkBefore ''
              local nvf_orgmode_loaded = false
              local nvf_orgmode_loading = false

              local function nvf_load_orgmode()
                if nvf_orgmode_loaded or nvf_orgmode_loading then
                  return
                end

                nvf_orgmode_loading = true
                local ok, err = xpcall(function()
            '';
          };
        }
        {
          orgmode = {
            before = [];
            after = [];
            data = lib.mkAfter ''
                end, debug.traceback)
                nvf_orgmode_loading = false

                if not ok then
                  error(err, 0)
                end

                nvf_orgmode_loaded = true
                vim.api.nvim_exec_autocmds("User", {
                  pattern = "NvfOrgmodeLoaded",
                  modeline = false,
                })
              end

              local nvf_orgmode_group = vim.api.nvim_create_augroup("nvf_orgmode_loader", { clear = true })
              vim.api.nvim_create_autocmd({ "BufReadPre", "BufNewFile" }, {
                group = nvf_orgmode_group,
                pattern = { "*.org", "*.org_archive" },
                callback = nvf_load_orgmode,
              })

              -- Snacks previews files through scratch buffers, so BufReadPre does
              -- not run before the Org ftplugin starts Treesitter.
              vim.api.nvim_create_user_command("NvfOrgmodeLoad", nvf_load_orgmode, {
                desc = "Load orgmode configuration",
              })

              vim.keymap.set("n", "<C-c>a", function()
                nvf_load_orgmode()
                require("orgmode").action("agenda.prompt")
              end, { desc = "Org agenda", silent = true })

              vim.keymap.set("n", "<C-c>c", function()
                nvf_load_orgmode()
                require("orgmode").action("capture.prompt")
              end, { desc = "Org capture", silent = true })
            '';
          };
        }
      ];

      notes.orgmode = {
        enable = true;
        treesitter.enable = false;
        setupOpts = let
          inbox_file = "${cfg.org_directory}/inbox.org";
        in {
          org_agenda_files = [
            inbox_file
          ];
          org_default_notes_file = inbox_file;
          org_startup_indented = true;
          org_id_link_to_org_use_id = true;
          org_id_method = "uuid";
          org_agenda_show_future_repeats = "next";
          win_split_mode = ["float" 0.7];
          win_border = "rounded";
          ui = {
            input = {
              use_vim_ui = true;
            };
          };
        };
      };

      autocomplete.blink-cmp.setupOpts.sources = {
        per_filetype.org = ["orgmode"] ++ myconfig.programs.nvf.autocomplete.default_sources;
        providers = {
          orgmode = {
            name = "Orgmode";
            module = "orgmode.org.autocompletion.blink";
            fallbacks = [
              "buffer"
            ];
          };
        };
      };

      autocmds = [
        {
          event = ["CmdlineLeave"];
          desc = "Open the Orgmode fold containing a confirmed search match";
          callback = lib.generators.mkLuaInline ''
            function(event)
              local buffer = event.buf
              if vim.bo[buffer].filetype ~= "org"
                or (event.match ~= "/" and event.match ~= "?")
                or vim.v.event.abort
              then
                return
              end

              local window = vim.api.nvim_get_current_win()
              vim.schedule(function()
                if not vim.api.nvim_buf_is_valid(buffer)
                  or not vim.api.nvim_win_is_valid(window)
                  or vim.api.nvim_win_get_buf(window) ~= buffer
                then
                  return
                end

                vim.api.nvim_win_call(window, function()
                  vim.cmd("normal! zv")
                end)
              end)
            end
          '';
        }
      ];
    };
  };
}
