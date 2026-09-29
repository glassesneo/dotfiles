{delib, ...}:
delib.module ({myconfig, ...}: {
  name = "hostname";

  # `just <layer> switch` without a host resolves this machine through `hostname -s`,
  # so the system name must match the Denix host name.
  darwin.always.networking = {
    hostName = myconfig.host.name;
    computerName = myconfig.host.name;
    localHostName = myconfig.host.name;
  };
})
