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

# `unknown` describes the current observation, not the visible latch. A prior
# nonzero state remains actionable while unavailable, but its observation never
# becomes a fabricated `attention` answer.
export def reduce [id: string, label: string, bundle_id: string, icon: string, previous: any, running: bool, badge: any, failed: bool, now: int] {
  let next = (observation $running $badge $failed)
  let prior_latched = if $previous == null { false } else {
    let prior_count = ($previous.count? | default null)
    $prior_count != null and $prior_count > 0 and (($previous.items? | default []) | length) > 0
  }
  let keep_latch = $next.observation == "unknown" and $prior_latched
  let count = if $next.observation == "attention" { $next.count } else if $keep_latch { $previous.count } else { $next.count }
  let badge_text = if $next.observation == "attention" { $next.badgeText } else if $keep_latch { $previous.badgeText } else { null }
  let items = if $next.observation == "attention" or $keep_latch {
    if $keep_latch { $previous.items } else { [{id: $id label: $label detail: $badge_text action: "activate-app" bundleId: $bundle_id icon: $icon}] }
  } else { [] }
  {
    schemaVersion: 1
    source: $id
    observation: $next.observation
    count: $count
    badgeText: $badge_text
    summary: (if $next.observation == "unknown" and $keep_latch { $"($label) badge unavailable; retaining prior attention" } else if $next.observation == "attention" { $"($label) ($badge_text | default $count)" } else { $"($label) has no visible Dock badge" })
    items: $items
    updatedAt: $now
  }
}

# Synthetic tests call this boundary directly; production supplies the isolated
# command output after establishing whether the application is running.
export def status_label_from_output [output: string] {
  let match = (try { $output | parse --regex '(?m)StatusLabel\s*=\s*"?(?<badge>[^"\n]*)' | first } catch { null })
  if $match == null { null } else { $match.badge | str trim }
}
