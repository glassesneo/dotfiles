{
  delib,
  host,
  inputs,
  lib,
  nodePackages,
  pkgs,
  sopsSecretPaths,
  ...
}: let
  # Typed submodule for a single MCP server catalog entry.
  serverType = lib.types.submodule {
    options = {
      command_id = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Nix package or command identifier for command-backed servers.";
      };
      url = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "URL for remote MCP servers.";
      };
      url_type = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Per-server type override (e.g. \"http\" for streamable HTTP).";
      };
      auth_secret = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "SOPS secret name for bearer-token auth.";
      };
      args = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
        description = "Arguments passed to the server command.";
      };
      env_keys = lib.mkOption {
        type = lib.types.attrsOf lib.types.str;
        default = {};
        description = "Environment variable mappings (key = env var name in output, value = source key).";
      };
      env_static = lib.mkOption {
        type = lib.types.attrsOf lib.types.str;
        default = {};
        description = "Static environment variable values.";
      };
      needs_node = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Whether the server script needs Node.js as its interpreter.";
      };
    };
  };
in
  delib.module {
    name = "programs.mcp-servers-nix";

    options.programs.mcp-servers-nix = with delib; {
      enable = boolOption true;

      # Shared server catalog — centralized definitions consumed by all targets.
      catalog = lib.mkOption {
        type = lib.types.attrsOf serverType;
        default = {
          brave-search = {
            command_id = "brave-search-mcp";
            env_keys = {BRAVE_API_KEY = "BRAVE_API_KEY";};
          };
          deepwiki = {
            url = "https://mcp.deepwiki.com/mcp";
          };
          readability = {
            command_id = "readability-mcp";
            needs_node = true;
          };
          tavily = {
            command_id = "tavily-mcp";
            env_keys = {TAVILY_API_KEY = "TAVILY_API_KEY";};
          };
          chrome-devtools = {
            command_id = "chrome-devtools-mcp";
          };
          morph-fast-apply = {
            command_id = "morph-fast-apply-mcp";
            env_keys = {MORPH_API_KEY = "MORPH_API_KEY";};
            env_static = {ALL_TOOLS = "false";};
          };
          codex = {
            command_id = "codex-mcp";
            args = ["mcp-server"];
          };
          context7 = {
            command_id = "context7-mcp";
          };
        };
        description = "Shared MCP server definitions. Each entry defines a server's command, URL, args, env, and behavior.";
      };

      # Per-target server membership — client modules contribute their lists
      # via myconfig.ifEnabled so each client owns its default membership.
      targets = {
        claude_code = listOfOption lib.types.str [];
        claude_desktop = listOfOption lib.types.str [];
        codex = listOfOption lib.types.str [];
        opencode = listOfOption lib.types.str [];
      };
    };

    home.ifEnabled = {cfg, ...}: let
      # Read typed config values.
      serverCatalog = cfg.catalog;
      enabledServersByTarget = cfg.targets;

      # Target adapter metadata stays centralized — these define how each
      # client renders server entries and are not client-owned concerns.
      claudeTargetMeta = {
        env_syntax_mode = "dollar_braces";
        env_field_name = "env";
        static_env_field_name = "env";
        url_type_policy = "sse";
        local_type_policy = null;
        command_list_behavior = false;
      };

      targetAdapters = {
        claude_code = claudeTargetMeta;
        claude_desktop = claudeTargetMeta;
        codex = {
          env_syntax_mode = "raw";
          env_field_name = "env_vars";
          static_env_field_name = "env";
          url_type_policy = null;
          local_type_policy = null;
          command_list_behavior = false;
        };
        opencode = {
          env_syntax_mode = "braces_env_colon";
          env_field_name = "environment";
          static_env_field_name = "environment";
          url_type_policy = "remote";
          local_type_policy = "local";
          command_list_behavior = true;
        };
      };

      requiredTargets = builtins.attrNames targetAdapters;
      serverNames = builtins.attrNames serverCatalog;
      commandBackedServers = lib.filterAttrs (_: server: server.command_id != null) serverCatalog;

      nodejs = lib.getExe pkgs.nodejs;
      cat = lib.getExe' pkgs.coreutils "cat";

      secretPath = name: sopsSecretPaths.${name} or "/run/secrets/${name}";

      mkSecretWrapper = {
        binaryName,
        wrappedName,
        secretName,
        envVarName,
      }:
        pkgs.writeShellScriptBin wrappedName ''
          secret_file="${secretPath secretName}"
          if [ ! -r "$secret_file" ]; then
            echo "Missing readable secret file: $secret_file" >&2
            exit 1
          fi

          export ${envVarName}="$(${cat} "$secret_file")"
          exec "${nodePackages}/bin/${binaryName}" "$@"
        '';

      wrappers = {
        brave-search-mcp = mkSecretWrapper {
          binaryName = "brave-search-mcp-server";
          wrappedName = "brave-search-mcp-server-wrapped";
          secretName = "brave-api-key";
          envVarName = "BRAVE_API_KEY";
        };
        tavily-mcp = mkSecretWrapper {
          binaryName = "tavily-mcp";
          wrappedName = "tavily-mcp-wrapped";
          secretName = "tavily-api-key";
          envVarName = "TAVILY_API_KEY";
        };
        morph-fast-apply-mcp = mkSecretWrapper {
          binaryName = "mcp-server-filesystem";
          wrappedName = "morph-fast-apply-mcp-wrapped";
          secretName = "morph-fast-apply-api-key";
          envVarName = "MORPH_API_KEY";
        };
      };

      wrapperManagedCommandIds = builtins.attrNames wrappers;

      resolvedCommands = {
        "brave-search-mcp" = lib.getExe wrappers."brave-search-mcp";
        "readability-mcp" = "${nodePackages}/lib/node_modules/@mizchi/readability/dist/mcp.js";
        "tavily-mcp" = lib.getExe wrappers."tavily-mcp";
        "chrome-devtools-mcp" = "${nodePackages}/bin/chrome-devtools-mcp";
        "morph-fast-apply-mcp" = lib.getExe wrappers."morph-fast-apply-mcp";
        "context7-mcp" = lib.getExe inputs.mcp-servers-nix.packages.${host.homeManagerSystem}.context7-mcp;
      };

      serverWithoutWrapperEnv = server:
        if server.command_id != null && builtins.elem server.command_id wrapperManagedCommandIds
        then server // {env_keys = {};}
        else server;

      resolveCommandToken = server:
        if server.command_id == null
        then ""
        else resolvedCommands.${server.command_id} or server.command_id;

      resolveServerCommand = server:
        if server.needs_node
        then nodejs
        else resolveCommandToken server;

      resolveServerArgs = server:
        if server.needs_node
        then [(resolveCommandToken server)] ++ server.args
        else server.args;

      envFormatters = {
        dollar_env_colon = key: "\${env:" + key + "}";
        dollar_braces = key: "\${" + key + "}";
        dollar_bare = key: "$" + key;
        braces_env_colon = key: "{env:" + key + "}";
        raw = key: key;
      };

      formatEnvValue = mode: key: let
        formatter = envFormatters.${mode} or null;
      in
        if formatter == null
        then throw "Unsupported MCP env_syntax_mode `${mode}`"
        else formatter key;

      mkEnvFields = targetMeta: server: let
        dynamicFieldName = targetMeta.env_field_name;
        staticFieldName = targetMeta.static_env_field_name;

        dynamicFields =
          if server.env_keys == {}
          then {}
          else if dynamicFieldName == "env_vars"
          then {${dynamicFieldName} = lib.attrValues server.env_keys;}
          else {
            ${dynamicFieldName} = lib.mapAttrs (_: key: formatEnvValue targetMeta.env_syntax_mode key) server.env_keys;
          };

        staticFields =
          if server.env_static == {}
          then {}
          else {${staticFieldName} = server.env_static;};
      in
        if dynamicFields == {}
        then staticFields
        else if staticFields == {}
        then dynamicFields
        else if dynamicFieldName == staticFieldName
        then {
          ${dynamicFieldName} = dynamicFields.${dynamicFieldName} // staticFields.${staticFieldName};
        }
        else dynamicFields // staticFields;

      mkAuthHeaders = target: server:
        if server.auth_secret == null
        then {}
        else let
          secret = server.auth_secret;
          envVarName = lib.toUpper (builtins.replaceStrings ["-"] ["_"] secret);
          bearerValue =
            if builtins.elem target ["claude_code" "claude_desktop"]
            then "Bearer \${${envVarName}}"
            else if target == "opencode"
            then "Bearer {file:${secretPath secret}}"
            else "Bearer {env:${envVarName}}";
        in {
          headers.Authorization = bearerValue;
        };

      mkRenderedServer = target: targetMeta: server: let
        effectiveServer = serverWithoutWrapperEnv server;
        isClaudeTarget = builtins.elem target ["claude_code" "claude_desktop"];
        effectiveUrlType =
          if isClaudeTarget && effectiveServer.url_type != null
          then effectiveServer.url_type
          else targetMeta.url_type_policy;
        command = resolveServerCommand effectiveServer;
        args = resolveServerArgs effectiveServer;
      in
        if effectiveServer.url != null
        then
          {url = effectiveServer.url;}
          // lib.optionalAttrs (effectiveUrlType != null) {type = effectiveUrlType;}
          // mkAuthHeaders target effectiveServer
        else
          (
            if targetMeta.command_list_behavior
            then {command = [command] ++ args;}
            else
              {command = command;}
              // lib.optionalAttrs (args != []) {args = args;}
          )
          // lib.optionalAttrs (targetMeta.local_type_policy != null) {type = targetMeta.local_type_policy;}
          // mkEnvFields targetMeta effectiveServer;

      mkServersForTarget = target: let
        targetMeta = targetAdapters.${target};
      in
        lib.filterAttrs (name: _: builtins.elem name enabledServersByTarget.${target}) (
          lib.mapAttrs (_: server: mkRenderedServer target targetMeta server) serverCatalog
        );

      context7Targets = ["claude_code" "claude_desktop" "codex"];

      mkTargetModule = target:
        lib.optionalAttrs (builtins.elem target context7Targets) {
          programs.context7 = {
            enable = true;
            type = "stdio";
          };
        }
        // {
          settings.servers = mkServersForTarget target;
        };

      renderedTargetModules = lib.genAttrs requiredTargets mkTargetModule;

      # --- Assertions ---

      mkServerShapeAssertions =
        lib.mapAttrsToList (name: server: {
          assertion = (server.url != null) != (server.command_id != null);
          message = "MCP server `${name}` must define exactly one of `url` or `command_id` (found ${
            if (server.url != null) && (server.command_id != null)
            then "both"
            else "neither"
          }).";
        })
        serverCatalog;

      # All target keys are guaranteed by typed options — no need for
      # mkRequiredTargetAssertions; the module system enforces presence.

      mkEnabledServerAssertions = lib.flatten (
        map (
          target:
            map (serverName: {
              assertion = builtins.elem serverName serverNames;
              message = "MCP enabled.${target} references unknown server `${serverName}`.";
            })
            enabledServersByTarget.${target}
        )
        requiredTargets
      );

      mkNeedsNodeAssertions = lib.flatten (
        lib.mapAttrsToList (
          name: server:
            lib.optional server.needs_node {
              assertion = server.command_id != null;
              message = "MCP server `${name}` has needs_node = true but does not define `command_id`.";
            }
        )
        serverCatalog
      );

      serverValidationAssertions =
        mkServerShapeAssertions
        ++ mkEnabledServerAssertions
        ++ mkNeedsNodeAssertions;

      commandAssertions = lib.flatten (
        lib.mapAttrsToList (
          name: server: let
            resolvedToken = resolveCommandToken server;
            hasCommandMapping = builtins.hasAttr server.command_id resolvedCommands;
          in
            [
              {
                assertion = builtins.stringLength resolvedToken > 0;
                message = "MCP server `${name}` command invariant failed: command_id `${server.command_id}` resolved to an empty command token.";
              }
            ]
            ++ lib.optional server.needs_node {
              assertion = hasCommandMapping;
              message = "MCP server `${name}` needs_node invariant failed: command_id `${server.command_id}` is missing from config.programs.mcp-servers.commands.";
            }
        )
        commandBackedServers
      );

      evalTargetServers = target:
        (inputs.mcp-servers-nix.lib.evalModule pkgs renderedTargetModules.${target}).config.settings.servers;
    in {
      assertions = commandAssertions ++ serverValidationAssertions;

      home.file = {
        "Library/Application Support/Claude/claude_desktop_config.json".source =
          inputs.mcp-servers-nix.lib.mkConfig pkgs renderedTargetModules.claude_desktop;
      };

      programs.claude-code.mcpServers = evalTargetServers "claude_code";
      programs.codex.settings.mcp_servers = evalTargetServers "codex";
      programs.opencode.settings.mcp = evalTargetServers "opencode";
    };
  }
