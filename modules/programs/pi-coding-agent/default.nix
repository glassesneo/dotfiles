{
  delib,
  homeConfig,
  llm-agents,
  ...
}:
let
  configDir = "${homeConfig.home.homeDirectory}/.pi/agent";
in
delib.module {
  name = "programs.pi-coding-agent";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    programs.pi-coding-agent = {
      enable = true;
      package = llm-agents.pi;
      inherit configDir;
      settings = {
        extensions = [
          "${./extensions}/agent_artifact.ts"
          "${./extensions}/interaction_policy.ts"
          "${./extensions}/question.ts"
        ];
        prompts = [
          "${./prompts}"
        ];
      };
      keybindings = {
        "app.editor.external" = [ "alt+e" ];
        "app.message.copy" = [ "alt+c" ];
        "app.model.select" = [ "alt+m" ];
        "app.model.cycleBackward" = [ "alt+[" ];
        "app.model.cycleForward" = [ "alt+]" ];
        "app.thinking.cycle" = [ "alt+t" ];
        "tui.input.copy" = [ ];
        "app.clear" = [ ];

        "app.session.togglePath" = [ "alt+p" ];
        "app.session.toggleSort" = [ "alt+s" ];
        "app.session.toggleNamedFilter" = [ "alt+n" ];
        "app.session.rename" = [ "alt+r" ];
        "app.session.delete" = [ "alt+d" ];
        "app.session.deleteNoninvasive" = [ ];
        "app.models.clearAll" = [ "alt+x" ];
        "app.models.toggleProvider" = [ "alt+p" ];
        "app.tree.filter.default" = [ ];
        "app.tree.filter.noTools" = [ ];
        "app.tree.filter.userOnly" = [ ];
        "app.tree.filter.labeledOnly" = [ ];
        "app.tree.filter.all" = [ ];
        "app.tree.filter.cycleForward" = [ "alt+f" ];
        "app.tree.filter.cycleBackward" = [ "alt+shift+f" ];
      };
    };

    home.file."${configDir}/question-keybindings.json".source =
      ./extensions/question-keybindings.json;
  };
}
