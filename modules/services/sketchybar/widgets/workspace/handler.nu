use std/log

def update_focus [focused_workspace: string, previous_workspace?: string, --reset-all] {
  let workspace_widget_options = [
    label.drawing=on
    icon.drawing=off
    label.color=0xFFCCCCCC
  ]

  let focused_workspace_widget_options = [
    label.drawing=off
    icon.drawing=on
    label.color=0xFFFFFFFF
  ]

  log info $"($previous_workspace) -> ($focused_workspace)"

  if $reset_all {
    sketchybar --set '/workspace\..*/' ...$workspace_widget_options
  } else if $previous_workspace != null {
    sketchybar --set $"workspace.($previous_workspace)" ...$workspace_widget_options
  }

  sketchybar --set $"workspace.($focused_workspace)" ...$focused_workspace_widget_options
}

def update_display (workspaces: table<monitor-appkit-nsscreen-screens-id: int, workspace: string>) {
  for workspace in $workspaces {
    let workspace_id: string = $workspace.workspace
    let workspace_name = $"workspace.($workspace_id)"
    let monitor_id: int = $workspace.monitor-appkit-nsscreen-screens-id

    let workspace_widget_options = [
      $"associated_display=($monitor_id)"
    ]

    sketchybar --set $workspace_name ...$workspace_widget_options
  }
}

def main () {
  match $env.SENDER {
    "aerospace_workspace_change" => {
      update_focus $env.FOCUSED_WORKSPACE $env.PREV_WORKSPACE
    }
    "display_change" => {
      let focused_workspace: string = aerospace list-workspaces --focused
      update_focus $focused_workspace --reset-all

      let workspaces = aerospace list-workspaces --all --format '%{workspace}%{monitor-appkit-nsscreen-screens-id}' --json | from json
      update_display $workspaces
    }
    # When `sketchybar` --update is triggered
    "forced" => {
      let focused_workspace: string = aerospace list-workspaces --focused
      update_focus $focused_workspace --reset-all

      let workspaces = aerospace list-workspaces --all --format '%{workspace}%{monitor-appkit-nsscreen-screens-id}' --json | from json
      update_display $workspaces
    }
  }
}
