# Restore normal startup paths before loading the user's zshenv. No user file
# is modified. If later configuration removes our hook, restart fails closed.
if [[ $MONOCODE_ORIGINAL_ZDOTDIR_SET == 1 ]]; then
  ZDOTDIR=$MONOCODE_ORIGINAL_ZDOTDIR
else
  unset ZDOTDIR
fi
unset MONOCODE_ORIGINAL_ZDOTDIR MONOCODE_ORIGINAL_ZDOTDIR_SET
[[ -r ${ZDOTDIR:-$HOME}/.zshenv ]] && source "${ZDOTDIR:-$HOME}/.zshenv"

function _monocode_restart_probe {
  emulate -L zsh
  local request release
  IFS= read -r request <&9 || { zle -F 9; return }
  [[ $request == check:* ]] || return
  # Only the empty primary prompt qualifies: not vared, a continuation,
  # unread terminal input, or a prompt with running/stopped background jobs.
  if [[ $CONTEXT != start || -n $BUFFER || ${#jobstates} != 0 ||
        ${KEYS_QUEUED_COUNT:-1} != 0 || ${PENDING:-1} != 0 ]]; then
    print -r -- "busy:${request#check:}" >&9
    return
  fi
  print -r -- "ready:${request#check:}" >&9 || return
  # Keep this prompt parked until native cancellation or process exit. This
  # uses the private socket, never terminal input or a signal to the shell.
  while IFS= read -r release <&9; do
    [[ $release == "resume:${request#check:}" ]] && break
  done
}

function _monocode_restart_setup {
  emulate -L zsh
  zmodload zsh/parameter || return
  zle -N _monocode_restart_probe
  zle -F -w 9 _monocode_restart_probe
}
precmd_functions+=(_monocode_restart_setup)
