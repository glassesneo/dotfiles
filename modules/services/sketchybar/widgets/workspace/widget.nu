use std/log

def main [direction: string] {
  const name = "@name@"
  const listener = "workspaces-listener"
  let workspaces: table<monitor-appkit-nsscreen-screens-id: int, workspace: string> = aerospace list-workspaces --all --format '%{workspace}%{monitor-appkit-nsscreen-screens-id}' --json | from json

  log info $"Rendering ($name)"

  for workspace in $workspaces {
    let workspace_id: string = $workspace.workspace
    let workspace_name = $"workspace.($workspace_id)"
    let monitor_id: int = $workspace.monitor-appkit-nsscreen-screens-id

    let workspace_widget_options = [
      $"associated_display=($monitor_id)"
      width=28
      $"label=($workspace_id)"
      label.font.size=14
      "label.font.style=Regular"
      label.align=center
      label.padding_left=8
      label.padding_right=8
      label.drawing=on
      "icon=•"
      icon.font.size=15
      icon.align=center
      icon.padding_left=8
      icon.padding_right=8
      icon.drawing=off
      $"click_script=aerospace workspace ($workspace_id)"
    ]

    sketchybar --add item $workspace_name $direction
    sketchybar --set $workspace_name ...$workspace_widget_options
  }

  let workspaces_widget_options = [
    background.color=0x00000000
  ]

  let listener_widget_options = [
    script="@script-path@"
  ]

  sketchybar --add bracket workspaces '/workspace\..*/'
  sketchybar --set workspaces ...$workspaces_widget_options
  sketchybar --add item $listener $direction
  sketchybar --add event aerospace_workspace_change
  sketchybar --set $listener ...$listener_widget_options
  sketchybar --subscribe $listener display_change aerospace_workspace_change
}
