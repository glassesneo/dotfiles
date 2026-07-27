{
  delib,
  homeConfig,
  ...
}: let
  configDir = "${homeConfig.home.homeDirectory}/.pi/agent";
in
  delib.module {
    name = "programs.pi-coding-agent.question";

    options = delib.singleCascadeEnableOption;

    myconfig.ifEnabled.programs.pi-coding-agent.profile.defaultTools = ["question"];

    home.ifEnabled = {
      programs.pi-coding-agent.settings.extensions = [
        "${./../../extensions_src}/question.ts"
      ];

      home.file."${configDir}/question-keybindings.json".source =
        ../../extensions_src/utilities/question-keybindings.json;
    };
  }
