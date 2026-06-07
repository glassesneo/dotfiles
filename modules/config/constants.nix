{delib, ...}:
delib.module {
  name = "constants";

  options = with delib;
    moduleOptions {
      username = readOnly (strOption "neo");
      userfullname = readOnly (strOption "Neo Kitani");
      useremail = readOnly (strOption "glassesneo@protonmail.com");
    };
}
