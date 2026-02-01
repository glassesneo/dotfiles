{
  delib,
  inputs,
  ...
}:
delib.module {
  name = "programs.agent-skills";

  options = delib.singleEnableOption false; # Disabled - skills managed centrally in agentSkills

  # Don't import the upstream module at all - we manage skills directly now
  # home.always = {
  #   imports = [
  #     inputs.agent-skills.homeManagerModules.default
  #   ];
  # };
}
