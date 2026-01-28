{
  delib,
  llm-agents,
  pkgs,
  ...
}:
delib.module {
  name = "programs.agent-browser";

  options = delib.singleEnableOption true;

  home.ifEnabled = let
    agentBrowserWrapped = pkgs.symlinkJoin {
      name = "agent-browser";
      paths = [llm-agents.agent-browser];
      buildInputs = [pkgs.makeWrapper];
      postBuild = ''
        wrapProgram $out/bin/agent-browser \
          --set PLAYWRIGHT_BROWSERS_PATH ${pkgs.playwright-driver.browsers}
      '';
    };
  in {
    home.packages = [
      agentBrowserWrapped
      pkgs.playwright-driver
    ];

    home.sessionVariables = {
      PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
    };
  };
}
