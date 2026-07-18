use ../providers/aerospace.nu
use ../providers/rift.nu

let fixture_dir = ($env.FILE_PWD | path join fixtures)

def assert [condition: bool, message: string] {
  if not $condition { error make {msg: $message} }
}

def main [] {
  let aerospace_ws = (open ($fixture_dir | path join aerospace-workspaces.json))
  let aerospace = (aerospace normalize $aerospace_ws "A")
  assert (($aerospace | length) == 2) "AeroSpace workspace count should normalize"
  assert (($aerospace | where focused == true | get id) == ["A"]) "AeroSpace focused workspace should be preserved"
  assert (($aerospace | where id == "A" | get display_id.0) == 2) "AeroSpace monitor association should be preserved"

  let rift_displays = (open ($fixture_dir | path join rift-displays.json))
  let rift_layouts = (open ($fixture_dir | path join rift-workspace-layout.json))
  let sketchybar_displays = (open ($fixture_dir | path join sketchybar-displays.json))
  let rift_ws = (rift normalize $rift_displays $rift_layouts $sketchybar_displays)
  assert (($rift_ws | length) == 2) "Rift workspace count should normalize"
  assert (($rift_ws | get id | uniq | length) == 2) "Rift duplicate labels on different displays must keep unique item ids"
  assert (($rift_ws | get label | uniq) == ["main"]) "Rift label should remain provider workspace name"
  assert (($rift_ws | sort-by display_id | get display_id) == [1 2]) "Rift display UUID/DirectDisplayID should map to arrangement ids"
}
