{
  delib,
  host,
  llm-agents,
  pkgs,
  ...
}:
delib.module {
  name = "programs.cursor-agent";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled = let
    # The upstream package contains top-level runtime files such as index.js.
    # Home Manager merges every home.packages output with buildEnv, so exposing
    # the full tree collides with playwright-core's own top-level index.js.
    # Only the executable is meant to be user-visible here.
    cursorAgentBin = pkgs.runCommandLocal "cursor-agent-bin-${llm-agents.cursor-agent.version or "unknown"}" {} ''
      mkdir -p "$out/bin"
      ln -s ${llm-agents.cursor-agent}/bin/* "$out/bin/"
    '';
  in {
    home.packages = [
      cursorAgentBin
    ];

    # Cursor loads personal skills from ~/.cursor/skills/. Restart Cursor or start
    # a new session after Home Manager activation for new skills to appear.
    home.file.".cursor/skills/after-implementation-report/SKILL.md".source =
      ./skills/after-implementation-report/SKILL.md;
  };
}
