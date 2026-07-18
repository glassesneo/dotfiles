export def item_name [id: string] { $"workspace.($id)" }

def required [record: record, field: string] {
  if ($field in ($record | columns)) { $record | get $field } else { error make {msg: $"missing required field ($field)"} }
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
