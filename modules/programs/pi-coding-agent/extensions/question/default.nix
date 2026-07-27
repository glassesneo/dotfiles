{delib, ...}:
delib.module {
  name = "programs.pi-coding-agent.question";

  options = delib.singleCascadeEnableOption;

  myconfig.ifEnabled.programs.pi-coding-agent.profile.defaultTools = ["question"];

  home.ifEnabled = {myconfig, ...}: {
    programs.pi-coding-agent.settings.extensions = [
      "${./../../extensions_src}/question.ts"
    ];

    home.file."${myconfig.programs.pi-coding-agent.configDir}/question-keybindings.json".source =
      ../../extensions_src/utilities/question-keybindings.json;
  };
}
