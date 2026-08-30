# Dock StatusLabel is an undocumented observation surface. Keep parsing and latch
# policy here so a replacement provider preserves the normalized record.
export def sanitize_badge [value: string] {
  $value | str replace --regex --all '[[:cntrl:]]' '' | str trim | str substring 0..24
}

export def observation [running: bool, badge: any, failed: bool] {
  if $failed or not $running { return {observation: "unknown" count: null badgeText: null} }
  let text = if $badge == null { "" } else { sanitize_badge ($badge | into string) }
  if ($text | is-empty) { return {observation: "clear" count: 0 badgeText: null} }
  if $text =~ '^[0-9]+$' {
    return {observation: "attention" count: ($text | into int) badgeText: $text}
  }
  {observation: "attention" count: 1 badgeText: $text}
}

export def reduce [id: string, label: string, bundle_id: string, icon: string, previous: any, running: bool, badge: any, failed: bool, now: int] {
  let next = (observation $running $badge $failed)
  let prior_attention = if $previous == null { false } else { ($previous.observation? | default "clear") == "attention" }
  let keep_latch = $next.observation == "unknown" and $prior_attention
  let visible = $next.observation == "attention" or $keep_latch
  let effective_count = if $next.observation == "attention" { $next.count } else if $keep_latch { $previous.count } else { 0 }
  let effective_badge = if $next.observation == "attention" { $next.badgeText } else if $keep_latch { $previous.badgeText } else { null }
  {
    schemaVersion: 1
    source: $id
    observation: (if $visible { "attention" } else { $next.observation })
    count: $effective_count
    badgeText: $effective_badge
    summary: (if $visible { $"($label) ($effective_badge | default $effective_count)" } else { $"($label) has no visible Dock badge" })
    items: (if $visible { [{id: $id label: $label detail: $effective_badge action: "activate-app" bundleId: $bundle_id icon: $icon}] } else { [] })
    updatedAt: $now
  }
}

# Synthetic tests call this boundary directly; production supplies the isolated
# command output after establishing whether the application is running.
export def status_label_from_output [output: string] {
  let match = (try { $output | parse --regex '(?m)StatusLabel\s*=\s*"?(?<badge>[^"\n]*)' | first } catch { null })
  if $match == null { null } else { $match.badge | str trim }
}
