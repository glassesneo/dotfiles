{delib, ...}:
delib.module {
  name = "constants";

  options.constants = with delib; {
    username = readOnly (strOption "neo");
    userfullname = readOnly (strOption "Neo Kitani");
    useremail = readOnly (strOption "glassesneo@protonmail.com");
  };
}
