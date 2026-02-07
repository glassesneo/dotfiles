tmux bind h select-pane -L
tmux bind j select-pane -D
tmux bind k select-pane -U
tmux bind l select-pane -R

tmux bind H split-window -h -b -c "#{pane_current_path}"
tmux bind L split-window -h -c "#{pane_current_path}"
tmux bind K split-window -v -b -c "#{pane_current_path}"
tmux bind J split-window -v -c "#{pane_current_path}"
tmux bind S split-window -v -l 10 -c "#{pane_current_path}"

tmux bind n new-window
tmux bind f next-window
tmux bind b previous-window
tmux bind w choose-tree
tmux bind p display-popup -E -d "#{pane_current_path}"
tmux bind -n S-Enter send-keys Escape "[13;2u"
