{
  delib,
  host,
  inputs,
  lib,
  nodePackages,
  nickelLib,
  nodePkgs,
  pkgs,
  ...
}:
delib.module {
  name = "programs.mcp-servers-nix";

  options.programs.mcp-servers-nix = with delib; {
    enable = boolOption true;
  };

  home.ifEnabled = let
    # Import server data from Nickel (single source of truth)
    serverData = nickelLib.importNickel "mcp-servers/main.ncl";

    # Command resolution map: command_id -> executable path
    # Nix handles all path resolution
    deno = pkgs.lib.getExe pkgs.deno;
    nodejs = pkgs.lib.getExe pkgs.nodejs;

    commands = {
      "brave-search-mcp" = "${nodePackages}/bin/brave-search-mcp-server";
      "readability-mcp" = "${nodePackages}/lib/node_modules/@mizchi/readability/dist/mcp.js";
      "tavily-mcp" = "${nodePackages}/bin/tavily-mcp";
      "chrome-devtools-mcp" = "${nodePackages}/bin/chrome-devtools-mcp";
      "morph-fast-apply-mcp" = "${nodePackages}/bin/mcp-server-filesystem";
      "kiri-mcp" = pkgs.lib.getExe' nodePkgs."kiri-mcp-server" "kiri-mcp-server";
      "context7-mcp" = pkgs.lib.getExe inputs.mcp-servers-nix.packages.${host.homeManagerSystem}.context7-mcp;
      # TODO(ownership): This path is host-specific and should move to a
      # host/flake-input based design in a separate follow-up.
      # Out of scope for the Nickel expansion plan: we intentionally keep the
      # current absolute path workaround so local dev can run the MCP server.
      "relative-filesystem-mcp" = "${deno} run -A /Users/neo/dev/relative-filesystem-mcp/server.ts";
    };

    # Command token resolved from commands map, fallback to command_id token
    resolveCommandToken = server: commands.${server.command_id} or server.command_id or "";

    # Helper to get command for a server
    getCommand = server:
      if server.needs_node
      then nodejs
      else resolveCommandToken server;

    # Helper to get args for a server (prepend script path for node servers)
    getArgs = server:
      if server.needs_node
      then [(resolveCommandToken server)] ++ server.args
      else server.args;

    commandBasedServers = lib.filterAttrs (_: server: server ? command_id) serverData.servers;

    commandAssertions = lib.flatten (
      lib.mapAttrsToList (
        name: server: let
          resolvedToken = resolveCommandToken server;
          hasCommandMapping = builtins.hasAttr server.command_id commands;
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
      commandBasedServers
    );

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

    mkServer = targetMeta: _name: server: let
      urlTypePolicy = targetMeta.url_type_policy;
      localTypePolicy = targetMeta.local_type_policy;
    in
      if server ? url
      then
        {url = server.url;}
        // lib.optionalAttrs (urlTypePolicy != null) {type = urlTypePolicy;}
      else
        (
          if targetMeta.command_list_behavior
          then {command = [(getCommand server)] ++ (getArgs server);}
          else
            {command = getCommand server;}
            // lib.optionalAttrs ((getArgs server) != []) {args = getArgs server;}
        )
        // lib.optionalAttrs (localTypePolicy != null) {type = localTypePolicy;}
        // mkEnvFields targetMeta server;

    mkServersForTarget = target: let
      targetMeta = serverData.targets_meta.${target};
    in
      lib.filterAttrs (name: _: builtins.elem name serverData.enabled.${target})
      (lib.mapAttrs (mkServer targetMeta) serverData.servers);

    # The syntax follows https://github.com/ravitemer/mcphub.nvim/blob/main/doc/mcp/servers_json.md
    mcphub-servers = {
      settings.servers = mkServersForTarget "mcphub";
    };

    # The syntax follows https://docs.claude.com/en/docs/claude-code/mcp
    claude-code-servers = {
      programs.context7 = {
        enable = true;
        type = "stdio";
      };
      settings.servers = mkServersForTarget "claude_code";
    };

    claude-desktop-servers = {
      programs.context7 = {
        enable = true;
        type = "stdio";
      };
      settings.servers = mkServersForTarget "claude_desktop";
    };

    codex-servers = {
      programs.context7 = {
        enable = true;
        type = "stdio";
      };
      settings.servers = mkServersForTarget "codex";
    };

    # The syntax follows https://opencode.ai/docs/mcp-servers
    opencode-servers = {
      settings.servers = mkServersForTarget "opencode";
    };
  in {
    assertions = commandAssertions;
    home.file = {
      # "${homeConfig.xdg.configHome}/mcphub/servers.json".source = inputs.mcp-servers-nix.lib.mkConfig pkgs mcphub-servers;
      "Library/Application Support/Claude/claude_desktop_config.json".source = inputs.mcp-servers-nix.lib.mkConfig pkgs claude-desktop-servers;
    };
    programs.claude-code.mcpServers = (inputs.mcp-servers-nix.lib.evalModule pkgs claude-code-servers).config.settings.servers;
    programs.codex.settings.mcp_servers = (inputs.mcp-servers-nix.lib.evalModule pkgs codex-servers).config.settings.servers;
    programs.opencode.settings.mcp = (inputs.mcp-servers-nix.lib.evalModule pkgs opencode-servers).config.settings.servers;
  };
}
