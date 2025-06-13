let
  userKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBOIatJ4jxTsywrBNYLuIP4p8AIANP1jmj7wM0KcIXb/ neo@macos-personal-laptop-01";
in {
  "gemini-api-key.age".publicKeys = [userKey];
  # "ai-mop-gpt-o4-mini-api-key.age".publicKeys = [userKey];
  "ai-mop-api-key.age".publicKeys = [userKey];
}
