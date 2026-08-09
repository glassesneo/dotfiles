use ../providers/aerospace.nu
use ../providers/rift.nu

let fixture_dir = ($env.FILE_PWD | path join fixtures)

def assert [condition: bool, message: string] {
  if not $condition { error make {msg: $message} }
}

def main [] {
  let aerospace_ws = (open ($fixture_dir | path join aerospace-workspaces.json))
  let focused_workspace = "A"
  let aerospace = (aerospace normalize $aerospace_ws $focused_workspace)
  assert (($aerospace | length) == ($aerospace_ws | length)) "AeroSpace should normalize every input workspace"
  assert (($aerospace | where focused == true | get id) == [$focused_workspace]) "AeroSpace focused workspace should be preserved"
  for workspace in $aerospace_ws {
    let normalized = ($aerospace | where id == ($workspace.workspace | into string) | first)
    assert ($normalized.display_id == $workspace.monitor-appkit-nsscreen-screens-id) "AeroSpace monitor association should be preserved"
  }

  let rift_displays = (open ($fixture_dir | path join rift-displays.json))
  let rift_layouts = (open ($fixture_dir | path join rift-workspace-layout.json))
  let sketchybar_displays = (open ($fixture_dir | path join sketchybar-displays.json))
  let rift_ws = (rift normalize $rift_displays $rift_layouts $sketchybar_displays)
  assert (($rift_ws | length) == ($rift_layouts | length)) "Rift should normalize every input workspace"
  assert (($rift_ws | get id | uniq | length) == ($rift_ws | length)) "Rift workspaces must keep unique item ids when labels repeat"
  for workspace in $rift_ws {
    let display = ($rift_displays | where uuid == $workspace.switch_target.display_uuid | first)
    let layout = (
      $rift_layouts
      | where {|item|
          ($item.space_id == $display.space) and (($item.index | into string) == ($workspace.switch_target.workspace_index | into string))
        }
      | first
    )
    let sketchybar_display = (
      $sketchybar_displays
      | where {|item|
          (($item.UUID? | default ($item.uuid? | default "")) == ($display.uuid | into string)) or ((($item.DirectDisplayID? | default ($item.direct-display-id? | default "")) | into string) == ($display.screen_id | into string))
        }
      | first
    )
    assert ($workspace.label == ($layout.name | into string)) "Rift workspace labels should preserve provider names"
    assert ($workspace.display_id == ($sketchybar_display | get arrangement-id)) "Rift displays should map to SketchyBar arrangement ids"
    assert ($workspace.focused == $layout.is_active) "Rift focused state should be preserved"
  }
}
