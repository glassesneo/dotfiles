def setup [] {
  let font = "Hack Nerd Font"

  let bar_config = [
    position=@position@,
    height=32
    color=0x00000000,
  ]

  let default_config = [
    padding_left=4
    padding_right=4
    $"icon.font=($font):Regular:17"
    $"label.font=($font):Regular:14"
    label.padding_left=4
    label.padding_right=4
  ]

  sketchybar --bar ...$bar_config
  sketchybar --default ...$default_config
}

setup
