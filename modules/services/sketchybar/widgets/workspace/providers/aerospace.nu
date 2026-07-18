export def item_name [id: string] { $"workspace.($id)" }

def required [record: record, field: string] {
  if ($field in ($record | columns)) { $record | get $field } else { error make {msg: $"missing required field ($field)"} }
}

export def normalize [workspaces: list<any>, focused: string] {
  $workspaces
  | sort-by workspace
  | each {|workspace|
      let label = (required $workspace workspace | into string)
      let display_id = (required $workspace monitor-appkit-nsscreen-screens-id)
      {
        id: $label
        item_name: (item_name $label)
        label: $label
        display_id: $display_id
        focused: ($label == $focused)
        switch_target: {provider: aerospace workspace: $label}
      }
    }
}
