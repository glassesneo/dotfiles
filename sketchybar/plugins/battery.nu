#!/usr/bin/env nu

let batteryList = pmset -g batt
  | lines
  | find '%;'
  | parse ' {top} (id={id}){percentage}%; {charging}; {rest}'

let percentage: int = $batteryList | get percentage | get 0
let charging: bool = $batteryList | get charging == "charging"

let icon: string = if $charging { "" } else match $percentage {
  91..100 => ""
  61..90 => ""
  31..60 => ""
  10..30 => ""
  _ => ""
}

sketchybar --set $env.NAME icon=$icon label=$"($percentage)%"
