export const base_url = "https://edu-iot.iniad.org/api/v1"

export def makeBasicAuth [user_id: string, user_password: string]: nothing -> string {
  let token = $"($user_id):($user_password)"
  return $"Basic ($token | encode base64)"
}

export module room {
  export def status [room_number: string]: nothing -> record {
    let auth = makeBasicAuth $env.INIAD_ID $env.INIAD_PASSWORD
    let result = http get --allow-errors -H {Authorization: $auth} $"($base_url)/sensors/($room_number)"
    return $result
  }
}

export module locker {
  export def status []: nothing -> record {
    let auth = makeBasicAuth $env.INIAD_ID $env.INIAD_PASSWORD
    let result = http get --allow-errors -H {Authorization: $auth} $"($base_url)/locker"
    return $result
  }

  export def open []: nothing -> record {
    let auth = makeBasicAuth $env.INIAD_ID $env.INIAD_PASSWORD
    let result = http post --allow-errors -H {Authorization: $auth} $"($base_url)/locker/open" ""
    return $result
  }
}

export module iccard {
  export def status []: nothing -> record {
    let auth = makeBasicAuth $env.INIAD_ID $env.INIAD_PASSWORD
    let result = http get --allow-errors -H {Authorization: $auth} $"($base_url)/iccards"
    return $result
  }

  export def register [uid: string, comment: string]: nothing -> record {
    let auth = makeBasicAuth $env.INIAD_ID $env.INIAD_PASSWORD
    let body = {uid: $uid, comment: $comment} | url build-query
    let result = http post --allow-errors -H {Authorization: $auth, Content-Type: application/x-www-form-urlencoded} $"($base_url)/iccards" body
    return $result
  }

  export def delete []: nothing -> record {
    let auth = makeBasicAuth $env.INIAD_ID $env.INIAD_PASSWORD
    let result = http delete --allow-errors -H {Authorization: $auth, Content-Type: application/x-www-form-urlencoded} $"($base_url)/iccards"
    return $result
  }
}
