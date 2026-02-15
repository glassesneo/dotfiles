# Registry of all host SSH public keys for agenix
# Each host needs an SSH key generated with: ssh-keygen -t ed25519 -f ~/.ssh/id_agenix
#
# To add a new host:
# 1. Generate SSH key on the new host: ssh-keygen -t ed25519 -f ~/.ssh/id_agenix -C "neo@hostname"
# 2. Add the public key here: hostname = "ssh-ed25519 AAAA... neo@hostname";
# 3. Re-encrypt all secrets: cd secrets && for f in *.age; do agenix -r -i ~/.ssh/id_agenix "$f"; done
{
  kurogane = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBOIatJ4jxTsywrBNYLuIP4p8AIANP1jmj7wM0KcIXb/ neo@macos-personal-laptop-01";
}
