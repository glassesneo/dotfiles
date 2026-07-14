{
  delib,
  host,
  llm-agents,
  ...
}:
delib.module {
  name = "programs.opencode";

  options = with delib;
    moduleOptions {
      enable = boolOption host.devCoreFeatured;
      permissionPolicy = enumOption ["normal" "trusted-vm"] "normal";
    };

  myconfig.ifEnabled.programs.mcp-servers-nix.targets.opencode = [
    "brave-search"
    "deepwiki"
    "readability"
    "context7"
  ];

  home.ifEnabled = let
    readSharedPrompt = name: builtins.readFile (./prompts/shared + "/${name}.md");
  in {
    programs.opencode = {
      enable = true;
      package = llm-agents.opencode;
      settings = {
        lsp = true;
        share = "disabled";
        autoupdate = false;
        default_agent = "scout";
      };
      context = readSharedPrompt "opencode-context";
      tui = {
        attention = {
          enabled = true;
          notifications = true;
          sound = false;
        };
      };
    };
  };
}
