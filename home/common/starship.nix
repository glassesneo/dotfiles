{
  programs.starship = {
    enable = true;
    settings = {
      "$schema" = "https://starship.rs/config-schema.json";
      scan_timeout = 10;
      format = ''
        [┌⦘](bold bright-green)$all
        [│](bold bright-green)$character $directory
        [└────>](bold bright-green) 
      '';
      add_newline = true;
      character = {
        error_symbol = "[:\\(](bold red)";
        success_symbol = "[:D](bold green)";
      };
      directory = {
        truncation_length = 0;
        truncate_to_repo = false;
      };
      line_break = {
        disabled = true;
      };
      username = {
        style_user = "pink bold";
        style_root = "black bold";
        format = "[$user⚜️ ]($style) ";
        disabled = false;
        show_always = true;
      };
      cmd_duration = {
        show_notifications = true;
      };
    };
  };
}
