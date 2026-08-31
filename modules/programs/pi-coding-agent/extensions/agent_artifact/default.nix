{
  delib,
  piArtifactRuntime,
  ...
}:
delib.module {
  name = "programs.pi-coding-agent.agent_artifact";
  options = delib.singleCascadeEnableOption;
  myconfig.always = {cfg, ...}: {
    args.shared.piArtifact.enabled = cfg.enable;
  };
  home.ifEnabled.programs.pi-coding-agent.settings.extensions = [piArtifactRuntime.extensionPath];
}
