{
  delib,
  homeConfig,
  llm-agents,
  ...
}: let
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
          prompts = [
            "${./prompts}"
          ];
          defaultModel = "gpt-5.6-sol";
          defaultProvider = "openai-codex";
          defaultThinkingLevel = "medium";

          theme = "dark";
        };
        keybindings = {
          "tui.editor.cursorLeft" = [
            "left"
            "ctrl+b"
          ];
          "tui.editor.cursorRight" = [
            "right"
            "ctrl+f"
          ];
          "tui.editor.cursorWordLeft" = [];
          "tui.editor.cursorWordRight" = [];
          "tui.editor.cursorLineStart" = [
            "home"
            "ctrl+a"
          ];
          "tui.editor.cursorLineEnd" = [
            "end"
            "ctrl+e"
          ];
          "tui.editor.jumpForward" = [];
          "tui.editor.jumpBackward" = [];
          "tui.editor.deleteCharForward" = ["delete"];
          "tui.editor.deleteWordBackward" = [];
          "tui.editor.deleteWordForward" = [];
          "tui.editor.deleteToLineStart" = [];
          "tui.editor.deleteToLineEnd" = [];
          "tui.input.newLine" = ["shift+enter"];
          "tui.editor.yank" = [];
          "tui.editor.yankPop" = [];
          "tui.editor.undo" = [];
          "tui.input.copy" = [];

          "app.clear" = ["ctrl+c"];
          "app.exit" = ["ctrl+d"];
          "app.suspend" = [];
          "app.editor.external" = ["ctrl+g"];
          "app.clipboard.pasteImage" = ["ctrl+v"];

          "app.session.togglePath" = ["ctrl+p"];
          "app.session.toggleSort" = ["ctrl+s"];
          "app.session.toggleNamedFilter" = ["ctrl+n"];
          "app.session.rename" = ["ctrl+r"];
          "app.session.delete" = ["ctrl+d"];
          "app.session.deleteNoninvasive" = [];

          "app.model.select" = [];
          "app.model.cycleBackward" = [];
          "app.model.cycleForward" = [];
          "app.thinking.cycle" = ["ctrl+t"];
          "app.thinking.toggle" = [];
          "app.tools.expand" = [];
          "app.message.copy" = [];
          "app.message.followUp" = ["ctrl+enter"];
          "app.message.dequeue" = ["ctrl+up"];

          "app.tree.foldOrUp" = ["ctrl+left"];
          "app.tree.unfoldOrDown" = ["ctrl+right"];
          "app.tree.filter.default" = [];
          "app.tree.filter.noTools" = [];
          "app.tree.filter.userOnly" = [];
          "app.tree.filter.labeledOnly" = [];
          "app.tree.filter.all" = [];
          "app.tree.filter.cycleForward" = [];
          "app.tree.filter.cycleBackward" = [];

          "app.models.save" = [];
          "app.models.enableAll" = [];
          "app.models.clearAll" = [];
          "app.models.toggleProvider" = [];
          "app.models.reorderUp" = [];
          "app.models.reorderDown" = [];
        };
      };
    };
  }
