{
  delib,
  inputs,
  ...
}:
delib.module {
  name = "programs.agent-skills";

  options = delib.singleEnableOption true;

  home.always = {
    # Import the agent-skills-nix Home Manager module
    # Each agent module (claude-code, codex, opencode) configures its own:
    # - sources (skill repositories)
    # - skills (which skills to enable)
    # - targets (where to deploy)
    imports = [
      inputs.agent-skills.homeManagerModules.default
    ];
  };
}
