{
  delib,
  homeConfig,
  lib,
  llm-agents,
  ...
}: let
  configDir = "${homeConfig.home.homeDirectory}/.pi/agent";
in
  delib.module {
    name = "programs.pi-coding-agent";

    options = with delib;
      moduleOptions {
        enable = boolOption true;
        defaultExtensions = readOnly (listOfOption str [
          "profile"
        ]);
      };

    home.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: let
      duplicates = lib.length cfg.defaultExtensions != lib.length (lib.unique cfg.defaultExtensions);
      resolveModule = name: let
        path = ["programs" "pi-coding-agent"] ++ lib.splitString "." name;
      in
        if lib.hasAttrByPath path myconfig
        then lib.attrByPath path null myconfig
        else null;
      selected =
        map (name: {
          inherit name;
          module = resolveModule name;
        })
        cfg.defaultExtensions;
      extensionPaths = lib.concatMap (item:
        if item.module != null && item.module ? extensionPaths
        then item.module.extensionPaths
        else [])
      selected;
    in {
      assertions = [
        {
          assertion = !duplicates;
          message = "Pi defaultExtensions must not contain duplicate module names.";
        }
        {
          assertion = builtins.all (item: item.module != null) selected;
          message = "Pi defaultExtensions must reference existing modules below programs.pi-coding-agent.";
        }
        {
          assertion = builtins.all (item: item.module == null || (item.module ? enable && item.module.enable)) selected;
          message = "Pi selected default extension modules must be enabled.";
        }
        {
          assertion = builtins.all (item: item.module == null || (item.module ? extensionPaths && item.module.extensionPaths != [])) selected;
          message = "Pi selected default extension modules must expose non-empty extensionPaths.";
        }
      ];

      programs.pi-coding-agent = {
        enable = true;
        package = llm-agents.pi;
        inherit configDir;
        settings = {
          extensions = lib.mkBefore extensionPaths;
          prompts = [
            "${./prompts}"
          ];
          defaultModel = "gpt-5.6-sol";
          defaultProvider = "openai-codex";
          defaultThinkingLevel = "medium";

          theme = "dark";
        };
        keybindings = {
          "tui.editor.cursorUp" = [
            "up"
            "ctrl+p"
          ];
          "tui.editor.cursorDown" = [
            "down"
            "ctrl+n"
          ];
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
          "tui.select.up" = [
            "up"
            "ctrl+p"
          ];
          "tui.select.down" = [
            "down"
            "ctrl+n"
          ];

          "app.clear" = ["ctrl+c"];
          "app.exit" = ["ctrl+d"];
          "app.suspend" = [];
          "app.editor.external" = ["ctrl+g"];
          "app.clipboard.pasteImage" = ["ctrl+v"];

          "app.session.togglePath" = [];
          "app.session.toggleSort" = ["ctrl+s"];
          "app.session.toggleNamedFilter" = [];
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
