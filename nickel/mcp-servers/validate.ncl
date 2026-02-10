let { Server, .. } = import "./schema.ncl" in

let RequiredTargets = [
  "mcphub",
  "claude_code",
  "claude_desktop",
  "codex",
  "crush",
  "opencode",
] in

let ConfigShape = {
  servers | { _ : Server },
  enabled | { _ : Array String },
} in

let ConfigValidator =
  std.contract.from_validator (fun config =>
    if
      !std.is_record config
      || !(std.record.has_field "servers" config)
      || !(std.record.has_field "enabled" config)
      || !std.is_record config.servers
      || !std.is_record config.enabled
    then
      'Ok
    else
      let missing_targets =
        std.array.filter (fun target => !(std.record.has_field target config.enabled)) RequiredTargets
      in

      if missing_targets != [] then
        'Error {
          message = "enabled is missing required target keys",
          notes = std.array.map (fun target => "missing target `%{target}`") missing_targets,
        }
      else
        let unknown_enabled_servers =
          std.array.flatten (
            std.array.map (fun target =>
              let unknown_for_target =
                std.array.filter (fun server_name =>
                  !(std.record.has_field server_name config.servers)
                )
                config.enabled."%{target}"
              in
              std.array.map
                (fun server_name => "enabled.%{target} references unknown server `%{server_name}`")
                unknown_for_target
            )
            RequiredTargets
          )
        in

        if unknown_enabled_servers != [] then
          'Error {
            message = "enabled target references unknown servers",
            notes = unknown_enabled_servers,
          }
        else
          let node_servers_without_command_id =
            std.array.filter (fun server_name =>
              let server = config.servers."%{server_name}" in
              server.needs_node && !(std.record.has_field "command_id" server)
            )
            (std.record.fields config.servers)
          in

          if node_servers_without_command_id != [] then
            'Error {
              message = "needs_node=true requires `command_id`",
              notes = std.array.map
                (fun server_name =>
                  "server `%{server_name}` has needs_node=true but does not define `command_id`"
                )
                node_servers_without_command_id,
            }
          else
            'Ok
  ) in

fun config => config | std.contract.all_of [ConfigShape, ConfigValidator]
