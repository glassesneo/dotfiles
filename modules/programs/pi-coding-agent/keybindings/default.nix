{
  delib,
  lib,
  ...
}: let
  roles = {
    moveUp = ["ctrl+p"];
    moveDown = ["ctrl+n"];
    moveLeft = ["left"];
    moveRight = ["right"];
    pageUp = ["pageUp"];
    pageDown = ["pageDown"];
    collapse = ["left"];
    expand = ["right"];
    confirm = ["enter"];
    cancel = ["escape" "ctrl+c"];
    back = ["escape"];
    itemToggle = ["space"];
    next = ["ctrl+f"];
    previous = ["ctrl+b"];
    newline = ["shift+enter"];
    submit = ["enter"];
    tab = ["tab"];
    clear = ["ctrl+c"];
    interrupt = ["escape"];
    exit = ["ctrl+d"];
  };

  nativeActions = {
    "tui.editor.cursorUp" = {
      role = "moveUp";
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.cursorDown" = {
      role = "moveDown";
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.cursorLeft" = {
      role = "moveLeft";
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.cursorRight" = {
      role = "moveRight";
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.cursorWordLeft" = {
      defaultKeys = [];
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.cursorWordRight" = {
      defaultKeys = [];
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.cursorLineStart" = {
      defaultKeys = ["home" "ctrl+a"];
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.cursorLineEnd" = {
      defaultKeys = ["end" "ctrl+e"];
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.jumpForward" = {
      defaultKeys = [];
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.jumpBackward" = {
      defaultKeys = [];
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.pageUp" = {
      role = "pageUp";
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.pageDown" = {
      role = "pageDown";
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.deleteCharBackward" = {
      defaultKeys = ["backspace"];
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.deleteCharForward" = {
      defaultKeys = ["delete" "ctrl+d"];
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.deleteWordBackward" = {
      defaultKeys = ["ctrl+w"];
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.deleteWordForward" = {
      defaultKeys = [];
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.deleteToLineStart" = {
      defaultKeys = [];
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.deleteToLineEnd" = {
      defaultKeys = [];
      contexts = ["editor.nonEmpty"];
    };
    "tui.input.newLine" = {
      role = "newline";
      contexts = ["editor.nonEmpty"];
    };
    "tui.input.submit" = {
      role = "submit";
      contexts = ["editor.nonEmpty"];
      required = true;
    };
    "tui.input.tab" = {
      role = "tab";
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.yank" = {
      defaultKeys = [];
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.yankPop" = {
      defaultKeys = [];
      contexts = ["editor.nonEmpty"];
    };
    "tui.editor.undo" = {
      defaultKeys = [];
      contexts = ["editor.nonEmpty"];
    };
    "tui.input.copy" = {
      defaultKeys = [];
      contexts = ["editor.nonEmpty"];
    };
    "tui.select.up" = {
      role = "moveUp";
      contexts = ["nativeSelector"];
    };
    "tui.select.down" = {
      role = "moveDown";
      contexts = ["nativeSelector"];
    };
    "tui.select.pageUp" = {
      role = "pageUp";
      contexts = ["nativeSelector"];
    };
    "tui.select.pageDown" = {
      role = "pageDown";
      contexts = ["nativeSelector"];
    };
    "tui.select.confirm" = {
      role = "confirm";
      contexts = ["nativeSelector"];
      required = true;
    };
    "tui.select.cancel" = {
      role = "cancel";
      contexts = ["nativeSelector"];
      required = true;
    };
    "app.interrupt" = {
      role = "interrupt";
      contexts = ["editor.running"];
    };
    "app.clear" = {
      role = "clear";
      contexts = ["editor.idleNonEmpty"];
    };
    "app.exit" = {
      role = "exit";
      contexts = ["editor.empty"];
    };
    "app.suspend" = {
      defaultKeys = [];
      contexts = ["app.global"];
    };
    "app.editor.external" = {
      defaultKeys = ["ctrl+g"];
      contexts = ["editor.nonEmpty"];
    };
    "app.clipboard.pasteImage" = {
      defaultKeys = ["ctrl+v"];
      contexts = ["editor.nonEmpty"];
    };
    "app.session.new" = {
      defaultKeys = [];
      contexts = ["app.global"];
    };
    "app.session.tree" = {
      defaultKeys = [];
      contexts = ["app.global"];
    };
    "app.session.fork" = {
      defaultKeys = [];
      contexts = ["app.global"];
    };
    "app.session.resume" = {
      defaultKeys = [];
      contexts = ["app.global"];
    };
    "app.session.togglePath" = {
      defaultKeys = [];
      contexts = ["sessionPicker"];
    };
    "app.session.toggleSort" = {
      defaultKeys = [];
      contexts = ["sessionPicker"];
    };
    "app.session.toggleNamedFilter" = {
      defaultKeys = [];
      contexts = ["sessionPicker"];
    };
    "app.session.rename" = {
      defaultKeys = ["ctrl+r"];
      contexts = ["sessionPicker.nonEmptyQuery"];
    };
    "app.session.delete" = {
      defaultKeys = ["ctrl+d"];
      contexts = ["sessionPicker.nonEmptyQuery"];
    };
    "app.session.deleteNoninvasive" = {
      defaultKeys = ["ctrl+backspace"];
      contexts = ["sessionPicker.emptyQuery"];
    };
    "app.model.select" = {
      defaultKeys = [];
      contexts = ["app.global"];
    };
    "app.model.cycleForward" = {
      defaultKeys = [];
      contexts = ["app.global"];
    };
    "app.model.cycleBackward" = {
      defaultKeys = [];
      contexts = ["app.global"];
    };
    "app.thinking.cycle" = {
      defaultKeys = ["ctrl+t"];
      contexts = ["app.global"];
    };
    "app.thinking.toggle" = {
      defaultKeys = [];
      contexts = ["transcript"];
    };
    "app.tools.expand" = {
      defaultKeys = [];
      contexts = ["transcript"];
    };
    "app.message.copy" = {
      defaultKeys = [];
      contexts = ["transcript"];
    };
    "app.message.followUp" = {
      defaultKeys = ["ctrl+enter"];
      contexts = ["editor.running"];
    };
    "app.message.dequeue" = {
      defaultKeys = ["ctrl+up"];
      contexts = ["editor.idleNonEmpty"];
    };
    "app.tree.foldOrUp" = {
      role = "collapse";
      contexts = ["tree"];
    };
    "app.tree.unfoldOrDown" = {
      role = "expand";
      contexts = ["tree"];
    };
    "app.tree.editLabel" = {
      defaultKeys = [];
      contexts = ["tree"];
    };
    "app.tree.toggleLabelTimestamp" = {
      defaultKeys = [];
      contexts = ["tree"];
    };
    "app.tree.filter.default" = {
      defaultKeys = [];
      contexts = ["tree"];
    };
    "app.tree.filter.noTools" = {
      defaultKeys = [];
      contexts = ["tree"];
    };
    "app.tree.filter.userOnly" = {
      defaultKeys = [];
      contexts = ["tree"];
    };
    "app.tree.filter.labeledOnly" = {
      defaultKeys = [];
      contexts = ["tree"];
    };
    "app.tree.filter.all" = {
      defaultKeys = [];
      contexts = ["tree"];
    };
    "app.tree.filter.cycleForward" = {
      defaultKeys = [];
      contexts = ["tree"];
    };
    "app.tree.filter.cycleBackward" = {
      defaultKeys = [];
      contexts = ["tree"];
    };
    "app.models.save" = {
      defaultKeys = [];
      contexts = ["scopedModels"];
    };
    "app.models.enableAll" = {
      defaultKeys = [];
      contexts = ["scopedModels"];
    };
    "app.models.clearAll" = {
      defaultKeys = [];
      contexts = ["scopedModels"];
    };
    "app.models.toggleProvider" = {
      defaultKeys = [];
      contexts = ["scopedModels"];
    };
    "app.models.reorderUp" = {
      defaultKeys = [];
      contexts = ["scopedModels"];
    };
    "app.models.reorderDown" = {
      defaultKeys = [];
      contexts = ["scopedModels"];
    };
  };
  nativeContribution = {
    enabled = true;
    actions = lib.mapAttrs (_: value:
      value
      // {
        target = "pi";
        required = value.required or false;
      })
    nativeActions;
  };
in
  delib.module {
    name = "programs.pi-coding-agent.keybindings";

    options = with delib;
      moduleOptions ({parent, ...}: {
        enable = readOnly (boolOption parent.enable);
        roles = attrsOfOption (lib.types.listOf lib.types.str) roles;
        overrides = attrsOfOption (lib.types.attrsOf (lib.types.listOf lib.types.str)) {};
        contributions = attrsOfOption lib.types.attrs {};
      });

    home.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: let
      allContributions = {pi = nativeContribution;} // cfg.contributions;
      enabledContributions = lib.filterAttrs (_: contribution: contribution.enabled or false) allContributions;
      overrideFor = feature: action:
        if cfg.overrides ? ${feature} && cfg.overrides.${feature} ? ${action}
        then cfg.overrides.${feature}.${action}
        else null;
      nativeAliasOverrides = lib.concatLists (lib.mapAttrsToList (
        feature: contribution:
          lib.concatLists (lib.mapAttrsToList (action: spec:
            if spec ? nativeAction && overrideFor feature action != null
            then [
              {
                inherit feature action;
                inherit (spec) nativeAction;
                keys = overrideFor feature action;
              }
            ]
            else [])
          contribution.actions)
      ) (lib.filterAttrs (feature: _: feature != "pi") enabledContributions));
      aliasesFor = nativeAction: builtins.filter (alias: alias.nativeAction == nativeAction) nativeAliasOverrides;
      resolveAction = feature: action: spec: let
        directOverride = overrideFor feature action;
        aliases =
          if feature == "pi"
          then aliasesFor action
          else [];
        override =
          if directOverride != null
          then directOverride
          else if aliases != []
          then (builtins.head aliases).keys
          else null;
      in
        spec
        // {
          keys =
            if override != null
            then override
            else if spec ? role
            then cfg.roles.${spec.role}
            else spec.defaultKeys;
        };
      resolvedBase = lib.mapAttrs (feature: contribution:
        contribution
        // {
          actions = lib.mapAttrs (resolveAction feature) contribution.actions;
        })
      enabledContributions;
      resolved =
        lib.mapAttrs (
          feature: contribution:
            if feature == "pi"
            then contribution
            else
              contribution
              // {
                actions =
                  lib.mapAttrs (
                    _: spec:
                      if spec ? nativeAction
                      then spec // {keys = resolvedBase.pi.actions.${spec.nativeAction}.keys;}
                      else spec
                  )
                  contribution.actions;
              }
        )
        resolvedBase;
      flat = lib.concatLists (lib.mapAttrsToList (
          feature: contribution:
            lib.mapAttrsToList (action: spec: spec // {inherit feature action;}) contribution.actions
        )
        resolved);
      specials = ["escape" "esc" "enter" "return" "tab" "space" "backspace" "delete" "insert" "clear" "home" "end" "pageUp" "pageDown" "up" "down" "left" "right"];
      symbols = ["`" "-" "=" "[" "]" "\\" ";" "'" "," "." "/" "!" "@" "#" "$" "%" "^" "&" "*" "(" ")" "_" "+" "|" "~" "{" "}" ":" "<" ">" "?"];
      validBase = base: builtins.match "[a-z0-9]" base != null || builtins.match "f([1-9]|1[0-2])" base != null || builtins.elem base (specials ++ symbols);
      canonicalKey = key: let
        parts = lib.splitString "+" key;
        base0 = lib.last parts;
        base =
          if base0 == "esc"
          then "escape"
          else if base0 == "return"
          then "enter"
          else base0;
        modifiers = lib.init parts;
        ordered = builtins.filter (modifier: builtins.elem modifier modifiers) ["ctrl" "shift" "alt"];
      in
        lib.concatStringsSep "+" (ordered ++ [base]);
      validKey = key: let
        parts = lib.splitString "+" key;
        modifiers = lib.init parts;
      in
        parts
        != []
        && builtins.all (modifier: builtins.elem modifier ["ctrl" "shift" "alt"]) modifiers
        && lib.length modifiers == lib.length (lib.unique modifiers)
        && validBase (lib.last parts);
      malformed = builtins.filter (entry: builtins.any (key: !validKey key) entry.keys) flat;
      missingSources = builtins.filter (entry: (entry ? role) == (entry ? defaultKeys)) flat;
      requiredEmpty = builtins.filter (entry: entry.required or false && entry.keys == []) flat;
      nativeAliasTargets = lib.unique (map (alias: alias.nativeAction) nativeAliasOverrides);
      conflictingNativeAliases = builtins.filter (target: lib.length (aliasesFor target) > 1 || overrideFor "pi" target != null) nativeAliasTargets;
      unknownOverrideFeatures = builtins.filter (feature: !(allContributions ? ${feature})) (builtins.attrNames cfg.overrides);
      unknownEnabledActions = lib.concatMap (
        feature:
          if !(enabledContributions ? ${feature})
          then []
          else map (action: "${feature}.${action}") (builtins.filter (action: !(enabledContributions.${feature}.actions ? ${action})) (builtins.attrNames cfg.overrides.${feature}))
      ) (builtins.attrNames cfg.overrides);
      dispatchEntries = builtins.filter (entry: entry.feature == "pi" || entry.target != "native") flat;
      keyed = lib.concatMap (entry:
        map (key:
          entry
          // {
            canonical = canonicalKey key;
            inherit key;
          })
        entry.keys)
      dispatchEntries;
      contextsOverlap = left: right:
        left
        == right
        || (left == "app.global" && right != "tmuxPreview")
        || (right == "app.global" && left != "tmuxPreview")
        || (left == "question.common" && lib.hasPrefix "question." right)
        || (right == "question.common" && lib.hasPrefix "question." left)
        || (left == "editor.nonEmpty" && builtins.elem right ["editor.idleNonEmpty" "editor.running"])
        || (right == "editor.nonEmpty" && builtins.elem left ["editor.idleNonEmpty" "editor.running"])
        || (left == "sessionPicker" && lib.hasPrefix "sessionPicker." right)
        || (right == "sessionPicker" && lib.hasPrefix "sessionPicker." left);
      collisions = lib.concatMap (left:
        map (right: {inherit left right;}) (builtins.filter (
            right:
              left.feature
              + "."
              + left.action
              < right.feature + "." + right.action
              && left.canonical == right.canonical
              && builtins.any (leftContext: builtins.any (rightContext: contextsOverlap leftContext rightContext) right.contexts) left.contexts
          )
          keyed))
      keyed;
      tmuxBases = ["escape" "esc" "enter" "return" "tab" "space" "backspace" "delete" "home" "end" "pageUp" "pageDown" "up" "down" "left" "right"] ++ lib.stringToCharacters "abcdefghijklmnopqrstuvwxyz0123456789" ++ map (number: "f${toString number}") (lib.range 1 12);
      tmuxRepresentable = key: let
        parts = lib.splitString "+" key;
        modifiers = lib.init parts;
        base = lib.last parts;
      in
        builtins.all (modifier: builtins.elem modifier ["ctrl" "shift"]) modifiers && builtins.elem base tmuxBases;
      badTmux = builtins.filter (entry: entry.target == "tmux" && builtins.any (key: !tmuxRepresentable key) entry.keys) flat;
      describe = entries: lib.concatStringsSep ", " (map (entry: "${entry.feature}.${entry.action}") entries);
      describeBadKeys = predicate: entries: lib.concatStringsSep ", " (lib.concatMap (entry: map (key: "${entry.feature}.${entry.action}=${key}") (builtins.filter predicate entry.keys)) entries);
      extensionMap = {
        schemaVersion = 1;
        features = lib.mapAttrs (_: contribution: lib.mapAttrs (_: spec: spec.keys) contribution.actions) (lib.filterAttrs (name: _: name != "pi") resolved);
      };
    in {
      assertions = [
        {
          assertion = malformed == [];
          message = "Pi keybinding grammar is invalid for: ${describeBadKeys (key: !validKey key) malformed}.";
        }
        {
          assertion = missingSources == [];
          message = "Pi keybinding contributions must specify exactly one role or defaultKeys: ${describe missingSources}.";
        }
        {
          assertion = requiredEmpty == [];
          message = "Pi required keybinding action has no keys: ${describe requiredEmpty}.";
        }
        {
          assertion = conflictingNativeAliases == [];
          message = "Pi native action overrides must use either pi.<action> or one native feature alias, not both: ${lib.concatStringsSep ", " conflictingNativeAliases}.";
        }
        {
          assertion = unknownOverrideFeatures == [];
          message = "Pi keybinding overrides reference unknown enabled feature(s): ${lib.concatStringsSep ", " unknownOverrideFeatures}.";
        }
        {
          assertion = unknownEnabledActions == [];
          message = "Pi keybinding overrides reference unknown enabled action(s): ${lib.concatStringsSep ", " unknownEnabledActions}.";
        }
        {
          assertion = collisions == [];
          message =
            if collisions == []
            then ""
            else "Pi keybinding conflicts: ${lib.concatStringsSep "; " (map (item: "${item.left.feature}.${item.left.action} and ${item.right.feature}.${item.right.action} use ${item.left.canonical}") collisions)}.";
        }
        {
          assertion = badTmux == [];
          message = "Pi tmux keybinding is not representable: ${describeBadKeys (key: !tmuxRepresentable key) badTmux}.";
        }
      ];
      programs.pi-coding-agent.keybindings = lib.mapAttrs (_: spec: spec.keys) resolved.pi.actions;
      home.file."${myconfig.programs.pi-coding-agent.configDir}/extension-keybindings.json".text = builtins.toJSON extensionMap;
    };
  }
