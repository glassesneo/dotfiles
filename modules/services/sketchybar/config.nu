use ./colors.nu

def setup [] {
  let font = "Hack Nerd Font"

  let bar_config = [
    position=@position@,
    height=32
    y_offset=2
    color=0x00000000,
  ]

  let default_config = [
    padding_left=4
    padding_right=4
    $"icon.font=($font):Regular:17"
    $"label.font=($font):Regular:14"
    label.padding_left=4
    label.padding_right=4
    $"label.color=($colors.text_primary)"
    $"icon.color=($colors.text_primary)"
  ]

  sketchybar --bar ...$bar_config
  sketchybar --default ...$default_config
}

setup
