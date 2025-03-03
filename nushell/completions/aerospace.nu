export module "aerospace extern" {
  def "nu-complete subcommands" [] {
    ^aerospace --help
    | lines
    | skip 3
    | each {|line| $line | parse '  {command} {rest}' | get command}
    | flatten 
  }

  def "nu-complete workspaces" [] {
    ^aerospace list-workspaces | lines
  }

  def "nu-complete window-id" [] {
    ^aerospace list-windows --all --json | from json | each {|x| $x | get window-id | into int}
  }

  def "nu-complete boundaries" [] {
    ["workspace", "all-monitors-outer-frame"]
  }

  def "nu-complete boundaries-action" [] {
    ["stop", "wrap-around-the-workspace", "wrap-around-all-monitors"]
  }

  def "nu-complete config --get" [] {
    ^aerospace config --all-keys | lines
  }

  export extern "aerospace balance-sizes" [
    --workspace: string@"nu-complete workspaces"
  ]

  export extern "aerospace close" [
    --quit-if-last-window
    --window-id: int@"nu-complete window-id"
  ]

  export extern "aerospace close-all-windows-but-current" [
    --quit-if-last-window
  ]

  export extern "aerospace config" [
    --get: string@"nu-complete config --get"
    --major-keys
    --all-keys
    --config-path
  ]

  export extern "aerospace config --get" [
    name: string@"nu-complete config --get"
    --json
    --keys
  ]

  export extern "aerospace config --major-keys" []

  export extern "aerospace config --all-keys" []

  export extern "aerospace config --config-path" []

  export extern "aerospace debug-windows" []

  export extern "aerospace enable" []

  export extern "aerospace enable toggle" []

  export extern "aerospace enable on" [
    --fail-if-noop
  ]

  export extern "aerospace enable off" [
    --fail-if-noop
  ]

  export extern "aerospace flatten-workspace-tree" [
    --workspace: string@"nu-complete workspaces"
  ]

  export extern "aerospace focus" [
    --ignore-floating
    --boundaries: string@"nu-complete boundaries"
    --boundaries-action: string@"nu-complete boundaries-action"
  ]

  export extern "aerospace" [
    command?: string@"nu-complete subcommands"
    --help (-h)
    --version (-v)
  ]
}
