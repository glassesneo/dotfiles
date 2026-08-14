{delib, ...}:
delib.module {
  name = "services.dbus";

  nixos.always.services.dbus.implementation = "broker";
}
