{
  delib,
  host,
  inputs,
  lib,
  nodePackages,
  nickelLib,
  nodePkgs,
  pkgs,
  sopsSecretPaths,
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
    nodejs = pkgs.lib.getExe pkgs.nodejs;
    cat = pkgs.lib.getExe' pkgs.coreutils "cat";

    secretPath = name: sopsSecretPaths.${name} or "/run/secrets/${name}";

    wrappers = {
      brave-search-mcp = pkgs.writeShellScriptBin "brave-search-mcp-server-wrapped" ''
        secret_file="${secretPath "brave-api-key"}"
        if [ ! -r "$secret_file" ]; then
          echo "Missing readable secret file: $secret_file" >&2
          exit 1
        fi

        export BRAVE_API_KEY="$(${cat} "$secret_file")"
        exec "${nodePackages}/bin/brave-search-mcp-server" "$@"
      '';

      tavily-mcp = pkgs.writeShellScriptBin "tavily-mcp-wrapped" ''
        secret_file="${secretPath "tavily-api-key"}"
        if [ ! -r "$secret_file" ]; then
          echo "Missing readable secret file: $secret_file" >&2
          exit 1
        fi

        export TAVILY_API_KEY="$(${cat} "$secret_file")"
        exec "${nodePackages}/bin/tavily-mcp" "$@"
      '';

      morph-fast-apply-mcp = pkgs.writeShellScriptBin "morph-fast-apply-mcp-wrapped" ''
        secret_file="${secretPath "morph-fast-apply-api-key"}"
        if [ ! -r "$secret_file" ]; then
          echo "Missing readable secret file: $secret_file" >&2
          exit 1
        fi

        export MORPH_API_KEY="$(${cat} "$secret_file")"
        exec "${nodePackages}/bin/mcp-server-filesystem" "$@"
      '';
    };

    wrapperManagedCommandIds = builtins.attrNames wrappers;

    commands = {
      "brave-search-mcp" = lib.getExe wrappers."brave-search-mcp";
      "readability-mcp" = "${nodePackages}/lib/node_modules/@mizchi/readability/dist/mcp.js";
      "tavily-mcp" = lib.getExe wrappers."tavily-mcp";
      "chrome-devtools-mcp" = "${nodePackages}/bin/chrome-devtools-mcp";
      "morph-fast-apply-mcp" = lib.getExe wrappers."morph-fast-apply-mcp";
      "kiri-mcp" = pkgs.lib.getExe' nodePkgs."kiri-mcp-server" "kiri-mcp-server";
      "context7-mcp" = pkgs.lib.getExe inputs.mcp-servers-nix.packages.${host.homeManagerSystem}.context7-mcp;
    };

    withWrapperManagedEnv = server:
      if builtins.elem (server.command_id or "") wrapperManagedCommandIds
      then server // {env_keys = {};}
      else server;

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
      (lib.mapAttrs (name: server: mkServer targetMeta name (withWrapperManagedEnv server)) serverData.servers);

    # Targets that require the context7 side-effect
    # See https://docs.claude.com/en/docs/claude-code/mcp and https://opencode.ai/docs/mcp-servers
    context7Targets = ["claude_code" "claude_desktop" "codex"];

    mkTargetConfig = target:
      lib.optionalAttrs (builtins.elem target context7Targets) {
        programs.context7 = {
          enable = true;
          type = "stdio";
        };
      }
      // {settings.servers = mkServersForTarget target;};

    claude-code-servers = mkTargetConfig "claude_code";
    claude-desktop-servers = mkTargetConfig "claude_desktop";
    codex-servers = mkTargetConfig "codex";
    opencode-servers = mkTargetConfig "opencode";
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
