{
  delib,
  host,
  lib,
  pkgs,
  sopsSecretPaths,
  ...
}: let
  # Typed submodule for a single MCP server catalog entry.
  serverType = delib.submodule {
    options = {
      command_id = with delib; description (allowNull (strOption null)) "Nix package or command identifier for command-backed servers.";
      url = with delib; description (allowNull (strOption null)) "URL for remote MCP servers.";
      auth_secret = with delib; description (allowNull (strOption null)) "SOPS secret name for bearer-token auth.";
      args = with delib; description (listOfOption str []) "Arguments passed to the server command.";
      env_keys = with delib; description (attrsOfOption str {}) "Environment variable mappings (key = env var name in output, value = source key).";
      env_static = with delib; description (attrsOfOption str {}) "Static environment variable values.";
    };
  };
in
  delib.module {
    name = "programs.mcp-servers";

    options = with delib;
      moduleOptions {
        enable = boolOption host.devCoreFeatured;

        # Shared server catalog — centralized definitions consumed by all targets.
        catalog = description (attrsOfOption serverType {
          brave-search = {
            command_id = "brave-search-mcp";
            env_keys = {BRAVE_API_KEY = "BRAVE_API_KEY";};
          };
          deepwiki = {
            url = "https://mcp.deepwiki.com/mcp";
          };
          context7 = {
            command_id = "context7-mcp";
          };
        }) "Shared MCP server definitions. Each entry defines a server's command, URL, args, env, and behavior.";

        # Per-target server membership — client modules contribute their lists
        # via myconfig.ifEnabled so each client owns its default membership.
        targets = {
          opencode = listOfOption str [];
        };
      };

    home.ifEnabled = {cfg, ...}: let
      # Read typed config values.
      serverCatalog = cfg.catalog;
      enabledServersByTarget = cfg.targets;

      # Target adapter metadata stays centralized — these define how each
      # client renders server entries and are not client-owned concerns.
      targetAdapters = {
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

      cat = lib.getExe' pkgs.coreutils "cat";
      braveSearchMcpServer = pkgs.callPackage ../../../packages/brave-search-mcp-server {};

      secretPath = name: sopsSecretPaths.${name} or "/run/secrets/${name}";

      mkSecretWrapper = {
        package,
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
          exec "${lib.getExe package}" "$@"
        '';

      wrappers = {
        brave-search-mcp = mkSecretWrapper {
          package = braveSearchMcpServer;
          wrappedName = "brave-search-mcp-server-wrapped";
          secretName = "brave-api-key";
          envVarName = "BRAVE_API_KEY";
        };
      };

      wrapperManagedCommandIds = builtins.attrNames wrappers;

      resolvedCommands = {
        "brave-search-mcp" = lib.getExe wrappers."brave-search-mcp";
        "context7-mcp" = lib.getExe pkgs.context7-mcp;
      };

      serverWithoutWrapperEnv = server:
        if server.command_id != null && builtins.elem server.command_id wrapperManagedCommandIds
        then server // {env_keys = {};}
        else server;

      resolveCommandToken = server:
        if server.command_id == null
        then ""
        else resolvedCommands.${server.command_id} or server.command_id;

      envFormatters = {
        braces_env_colon = key: "{env:" + key + "}";
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

      mkAuthHeaders = server:
        if server.auth_secret == null
        then {}
        else let
          secret = server.auth_secret;
        in {
          headers.Authorization = "Bearer {file:${secretPath secret}}";
        };

      mkRenderedServer = targetMeta: server: let
        effectiveServer = serverWithoutWrapperEnv server;
        command = resolveCommandToken effectiveServer;
        args = effectiveServer.args;
      in
        if effectiveServer.url != null
        then
          {url = effectiveServer.url;}
          // lib.optionalAttrs (targetMeta.url_type_policy != null) {type = targetMeta.url_type_policy;}
          // mkAuthHeaders effectiveServer
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
          lib.mapAttrs (_: server: mkRenderedServer targetMeta server) serverCatalog
        );

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

      serverValidationAssertions =
        mkServerShapeAssertions
        ++ mkEnabledServerAssertions;

      commandAssertions = lib.flatten (
        lib.mapAttrsToList (
          name: server: let
            resolvedToken = resolveCommandToken server;
          in {
            assertion = builtins.stringLength resolvedToken > 0;
            message = "MCP server `${name}` command invariant failed: command_id `${server.command_id}` resolved to an empty command token.";
          }
        )
        commandBackedServers
      );
    in {
      assertions = commandAssertions ++ serverValidationAssertions;

      programs.opencode.settings.mcp = mkServersForTarget "opencode";
    };
  }
