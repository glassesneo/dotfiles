{delib, ...}:
delib.module {
  name = "programs.pi-coding-agent.question";

  options = delib.singleCascadeEnableOption;

  myconfig.always = {cfg, ...}: {
    programs.pi-coding-agent.keybindings.contributions.question = {
      enabled = cfg.enable;
      actions = {
        "common.next-question" = {
          role = "next";
          contexts = ["question.common"];
          required = true;
          target = "extension";
        };
        "common.previous-question" = {
          role = "previous";
          contexts = ["question.common"];
          required = true;
          target = "extension";
        };
        "common.back" = {
          role = "back";
          contexts = ["question.common"];
          required = true;
          target = "extension";
        };
        "common.cancel" = {
          defaultKeys = ["ctrl+c"];
          contexts = ["question.choice" "question.text" "question.review"];
          required = true;
          target = "extension";
        };
        "choice.accept" = {
          role = "confirm";
          contexts = ["question.choice"];
          required = true;
          target = "extension";
        };
        "choice.move-up" = {
          role = "moveUp";
          contexts = ["question.choice"];
          required = true;
          target = "extension";
        };
        "choice.move-down" = {
          role = "moveDown";
          contexts = ["question.choice"];
          required = true;
          target = "extension";
        };
        "choice.toggle" = {
          role = "itemToggle";
          contexts = ["question.choice"];
          required = false;
          target = "extension";
        };
        "choice.select-and-note" = {
          defaultKeys = ["e"];
          contexts = ["question.choice"];
          required = false;
          target = "extension";
        };
        "choice.write-in" = {
          defaultKeys = ["shift+enter"];
          contexts = ["question.choice"];
          required = true;
          target = "extension";
        };
        "editor.clear" = {
          defaultKeys = ["ctrl+c"];
          contexts = ["question.note" "question.write-in"];
          required = true;
          target = "extension";
        };
        "review.accept" = {
          role = "confirm";
          contexts = ["question.review"];
          required = true;
          target = "extension";
        };
        "review.move-up" = {
          role = "moveUp";
          contexts = ["question.review"];
          required = true;
          target = "extension";
        };
        "review.move-down" = {
          role = "moveDown";
          contexts = ["question.review"];
          required = true;
          target = "extension";
        };
        "text.accept" = {
          role = "submit";
          contexts = ["question.text"];
          required = true;
          target = "extension";
        };
        "text.newline" = {
          role = "newline";
          contexts = ["question.text"];
          required = true;
          target = "extension";
        };
      };
    };
  };

  myconfig.ifEnabled.programs.pi-coding-agent.mode.modes.recon.tools = ["question"];

  home.ifEnabled.programs.pi-coding-agent.settings.extensions = [
    "${./../../extensions_src}/question.ts"
  ];
}
