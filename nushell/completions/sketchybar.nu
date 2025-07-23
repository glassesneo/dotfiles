export module "sketchybar extern" {
  def "nu-complete positions" [] {
    ["center", "left", "right"]
  }

  def "nu-complete components" [] {
    ["item", "graph", "space", "bracket", "alias", "slider"]
  }

  def "nu-complete preposition" [] {
    ["before", "after"]
  }

  def "nu-complete items" [] {
    ^sketchybar --query bar | from json | get items
  }

  def filter-item-by-type [type: string@"nu-complete components"]: list<string> -> list<string> {
    $in
    | each {|item| ^sketchybar --query $item | from json}
    | where {|item| ($item | get type) == $type}
    | each {|item| $item | get name}
  }

  def "nu-complete graph items" [] {
    (nu-complete items) | filter-item-by-type graph
  }

  def "nu-complete default menu items" [] {
    ^sketchybar --query default_menu_items | from json
  }

  def "nu-complete events" [] {
    ^sketchybar --query events | from json | columns
  }

  def "nu-complete --add" [] {
    (nu-complete components) | append "event"
  }

  def "nu-complete --query" [] {
    "bar" | append (nu-complete items) | append ["defaults", "events", "default_menu_items"]
  }

  def "nu-complete --animate" [] {
    ["linear", "quadratic", "tanh", "sin", "exp", "circ"]
  }

  def "nu-complete --hotload" [] {
    [true, false]
  }

  export extern "sketchybar --add" [
    component: string@"nu-complete --add"
    name: string
    position: string@"nu-complete positions"
  ]

  export extern "sketchybar --add graph" [
    name: string
    position: string@"nu-complete positions"
    width_in_points: int
  ]

  export extern "sketchybar --add bracket" [
    name: string
    ...member_names: string@"nu-complete items"
  ]

  export extern "sketchybar --add alias" [
    name: string@"nu-complete default menu items"
    position: string@"nu-complete positions"
  ]

  export extern "sketchybar --add slider" [
    name: string
    position: string@"nu-complete positions"
    width: int
  ]

  export extern "sketchybar --add event" [
    name: string
    notification_name?: string
  ]

  export extern "sketchybar --animate" [
    curve: string@"nu-complete --animate"
  ]

  export extern "sketchybar --bar" [
    ...properties: string
  ]

  export extern "sketchybar --clone" [
    parent_name: string@"nu-complete items"
    name: string
    preposition?: string@"nu-complete preposition"
  ]

  export extern "sketchybar --config" []

  export extern "sketchybar --default" [
    ...properties: string
  ]

  export extern "sketchybar --help" []

  export extern "sketchybar --move" [
    name: string@"nu-complete items"
    preposition: string@"nu-complete preposition"
    reference_name: string@"nu-complete items"
  ]

  export extern "sketchybar --push" [
    name: string@"nu-complete graph items"
    ...data_point: float
  ]

  export extern "sketchybar --query" [
    type: string@"nu-complete --query"
  ]

  export extern "sketchybar --reload" []

  export extern "sketchybar --remove" [
    name: string@"nu-complete items"
  ]

  export extern "sketchybar --rename" [
    old_name: string@"nu-complete items"
    new_name: string
  ]

  export extern "sketchybar --reorder" [
    ...names: string@"nu-complete items"
  ]

  export extern "sketchybar --set" [
    name: string@"nu-complete items"
    ...properties: string
  ]

  export extern "sketchybar --subscribe" [
    name: string@"nu-complete items"
    ...events: string@"nu-complete events"
  ]

  export extern "sketchybar --trigger" [
    event: string@"nu-complete events"
    envvars?: string
  ]

  export extern "sketchybar --update" []
}
