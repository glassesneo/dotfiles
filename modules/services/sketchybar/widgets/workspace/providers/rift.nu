export def item_name [id: string] { $"workspace.($id)" }

def required [record: record, field: string] {
  if ($field in ($record | columns)) { $record | get $field } else { error make {msg: $"missing required field ($field)"} }
}

# Project one native workspace event onto a saved normalized snapshot. Returning
# null tells the handler that the event is not safe to apply incrementally.
export def event_focus_update [snapshot: any, event: record] {
  try {
    let workspace_name = (required $event workspace_name | into string)
    let display_uuid = (required $event display_uuid | into string)
    let space_id = (required $event space_id | into string)
    if (($workspace_name | str trim) == "") or (($display_uuid | str trim) == "") or (($space_id | str trim) == "") {
      return null
    }

    let workspaces = (required $snapshot workspaces)
    let matches = ($workspaces | where {|workspace|
      [
        ((required (required $workspace switch_target) provider) == "rift")
        ((required (required $workspace switch_target) display_uuid | into string) == $display_uuid)
        ((required $workspace label | into string) == $workspace_name)
      ] | all {|matched| $matched }
    })
    if ($matches | length) != 1 { return null }

    let target = (required ($matches | first) item_name | into string)
    let previous = ($workspaces | where {|workspace|
      [
        ((required $workspace focused) == true)
        ((required (required $workspace switch_target) display_uuid | into string) == $display_uuid)
      ] | all {|matched| $matched }
    } | each {|workspace| required $workspace item_name | into string })
    let updated = ($workspaces | each {|workspace|
      let workspace_display_uuid = (required (required $workspace switch_target) display_uuid | into string)
      let is_focused = if $workspace_display_uuid == $display_uuid {
        (required $workspace item_name | into string) == $target
      } else {
        required $workspace focused
      }
      $workspace | upsert focused $is_focused
    })
    {
      focused: [$target]
      previous: $previous
      snapshot: ($snapshot | upsert workspaces $updated)
    }
  } catch {
    null
  }
}

export def normalize [rift_displays: list<any>, layouts: list<any>, sketchybar_displays: list<any>] {
  $layouts | each {|layout|
    let display = ($rift_displays | where {|d| (required $d space) == (required $layout space_id)} | first)
    let uuid = (required $display uuid | into string)
    let screen_id = (required $display screen_id | into string)
    let sb = (
      $sketchybar_displays
      | where {|d| (($d.UUID? | default ($d.uuid? | default "")) == $uuid) or ((($d.DirectDisplayID? | default ($d.direct-display-id? | default "")) | into string) == $screen_id)}
      | first
    )
    let arrangement = ($sb | get arrangement-id)
    let index = (required $layout index | into string)
    let id = $"rift.($uuid).($index)"
    {
      id: $id
      item_name: (item_name $id)
      label: (required $layout name | into string)
      display_id: $arrangement
      focused: ((required $layout is_active) == true)
      switch_target: {provider: rift display_uuid: $uuid workspace_index: (required $layout index)}
    }
  }
}
