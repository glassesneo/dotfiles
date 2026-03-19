if [ -n "${GHOSTTY_QUICK_TERMINAL:-}" ]; then
  printf '\e]11;@color@\e\\'
elif [ -n "${GHOSTTY_RESOURCES_DIR:-}" ]; then
  printf '\e]111\e\\'
else
fi
