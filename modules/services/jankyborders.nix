{
  delib,
  host,
  ...
}:
delib.module {
  name = "jankyborders";

  options = delib.singleEnableOption host.isDesktop;

  darwin.ifEnabled.services.jankyborders = {
    enable = true;
    active_color = "0xfff4dbd6";
    inactive_color = "0x00000000";
    style = "round";
    width = 5.0;
    hidpi = true;
  };
}
