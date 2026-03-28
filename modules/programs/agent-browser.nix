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
    playwrightBrowsersPath = pkgs.playwright-driver.browsers;
    chromiumBundleDir =
      pkgs.lib.findFirst
      (name: pkgs.lib.hasPrefix "chromium-" name)
      (throw "programs.agent-browser: pkgs.playwright-driver.browsers does not contain a Chromium bundle")
      (builtins.attrNames (builtins.readDir playwrightBrowsersPath));
    browserExecutable =
      if pkgs.stdenv.hostPlatform.isDarwin
      then let
        chromeDir =
          if pkgs.stdenv.hostPlatform.isAarch64
          then "chrome-mac-arm64"
          else "chrome-mac";
      in "${playwrightBrowsersPath}/${chromiumBundleDir}/${chromeDir}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
      else "${playwrightBrowsersPath}/${chromiumBundleDir}/chrome-linux/chrome";
    browserExecutableEscaped = pkgs.lib.escapeShellArg browserExecutable;
    agentBrowserWrapped = pkgs.symlinkJoin {
      name = "agent-browser";
      paths = [llm-agents.agent-browser];
      buildInputs = [pkgs.makeWrapper];
      postBuild = ''
        wrapProgram $out/bin/agent-browser \
          --set PLAYWRIGHT_BROWSERS_PATH ${playwrightBrowsersPath} \
          --set AGENT_BROWSER_EXECUTABLE_PATH ${browserExecutableEscaped}
      '';
    };
  in {
    home.packages = [
      agentBrowserWrapped
      pkgs.playwright-driver
    ];

    home.sessionVariables = {
      PLAYWRIGHT_BROWSERS_PATH = "${playwrightBrowsersPath}";
      AGENT_BROWSER_EXECUTABLE_PATH = browserExecutable;
    };
  };
}
