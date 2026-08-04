{delib, ...}:
delib.module {
  name = "programs.pi-coding-agent.interaction_policy";

  options = delib.singleCascadeEnableOption;

  myconfig.always = {cfg, ...}: {
    programs.pi-coding-agent.keybindings.contributions.interactionPolicy = {
      enabled = cfg.enable;
      actions = {
        clear = {
          role = "clear";
          contexts = ["interactionPolicy.idle"];
          required = true;
          target = "native";
          nativeAction = "app.clear";
        };
        interrupt = {
          role = "interrupt";
          contexts = ["interactionPolicy.running"];
          required = true;
          target = "native";
          nativeAction = "app.interrupt";
        };
      };
    };
  };

  home.ifEnabled.programs.pi-coding-agent.settings.extensions = [
    "${./../../extensions_src}/interaction_policy.ts"
  ];
}
