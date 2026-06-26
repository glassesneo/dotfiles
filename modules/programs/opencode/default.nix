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
      commandExecutionMode = enumOption ["restricted" "full"] "restricted";
    };

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
