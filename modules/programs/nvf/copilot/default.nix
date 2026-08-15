{
  delib,
  lib,
  llm-agents,
  ...
}:
delib.module {
  name = "programs.nvf.copilot";
  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nvf.settings.vim = {
    extraPackages = [llm-agents.copilot-language-server];
    luaConfigRC.copilot-privacy-policy = builtins.readFile ./copilot-lsp.lua;
    lazy.plugins.copilot-lua = {
      event = lib.mkForce [];
      keys = lib.mkForce [];
    };
    autocmds = [
      {
        event = ["FileType"];
        pattern = ["gitcommit"];
        desc = "Enable Copilot for Git commit messages";
        callback = lib.generators.mkLuaInline ''
          function()
            vim.schedule(function()
              vim.cmd("Copilot enable")
            end)
          end
        '';
      }
    ];
    assistant.copilot = {
      enable = true;
      cmp.enable = false;
      setupOpts = {
        panel.enabled = true;
        suggestion.enabled = false;
        filetypes.gitcommit = true;
        server = {
          type = "binary";
          custom_server_filepath = "copilot-language-server";
        };
        root_dir = lib.generators.mkLuaInline "_G.nvf_copilot_root_dir";
        should_attach = lib.generators.mkLuaInline "_G.nvf_copilot_should_attach";
        server_opts_overrides.on_attach = lib.generators.mkLuaInline "_G.nvf_copilot_on_attach";
      };
    };
  };
}
