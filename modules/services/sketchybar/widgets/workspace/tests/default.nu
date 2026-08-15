use ../providers/aerospace.nu
use ../providers/rift.nu

let fixture_dir = ($env.FILE_PWD | path join fixtures)

def assert [condition: bool, message: string] {
  if not $condition { error make {msg: $message} }
}

# Admission: the repository owns projection of native Rift events onto saved
# snapshots; malformed or ambiguous projection can focus the wrong display, and
# Nix evaluation/provider normalization cannot observe that state transition.
# Contract: given a native event and saved multi-display snapshot, the workspace
# adapter replaces focus only on the target display and returns target-display
# animation sets; unsafe matches return null for full resynchronization.
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

  let alternate = {
    id: "rift.display-2.1"
    item_name: "workspace.rift.display-2.1"
    label: "alternate"
    display_id: 2
    focused: false
    switch_target: {provider: rift display_uuid: "display-2" workspace_index: 1}
  }
  let snapshot = {workspaces: ($rift_ws | append $alternate)}
  let native_event = {workspace_name: "alternate" display_uuid: "display-2" space_id: "20"}
  let update = (rift event_focus_update $snapshot $native_event)
  assert ($update != null) "A complete native event should use the saved snapshot fast path"
  assert ($update.previous == ["workspace.rift.display-2.0"]) "Previous animation state should include only the previously focused target-display workspace"
  assert ($update.focused == ["workspace.rift.display-2.1"]) "Focused animation state should include only the event target"

  let display_1_before = ($snapshot.workspaces | where switch_target.display_uuid == "display-1")
  let display_1_after = ($update.snapshot.workspaces | where switch_target.display_uuid == "display-1")
  assert ($display_1_after == $display_1_before) "The fast path should preserve all snapshot state on unaffected displays"
  assert (($update.snapshot.workspaces | where item_name == "workspace.rift.display-2.0" | first | get focused) == false) "The previous target-display workspace should become inactive"
  assert (($update.snapshot.workspaces | where item_name == "workspace.rift.display-2.1" | first | get focused) == true) "The event target workspace should become active"

  let ambiguous_snapshot = {workspaces: ($snapshot.workspaces | append ($alternate | upsert item_name "workspace.synthetic-duplicate"))}
  assert ((rift event_focus_update $ambiguous_snapshot $native_event) == null) "Ambiguous display/name matches should request full resynchronization"
  assert ((rift event_focus_update $snapshot ($native_event | upsert workspace_name "stale")) == null) "Stale event names should request full resynchronization"
  assert ((rift event_focus_update $snapshot ($native_event | upsert space_id "")) == null) "Incomplete native events should request full resynchronization"
  assert ((rift event_focus_update null $native_event) == null) "Absent snapshots should request full resynchronization"
  assert ((rift event_focus_update {workspaces: [{focused: true}]} $native_event) == null) "Malformed snapshots should request full resynchronization"
}
