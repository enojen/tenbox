# Sourced by machine.sh. `busy_reason <answer>` reads the output of `tenbox-watchdog busy`:
# only a `busy: <reason>` line prints the reason and returns 0; old watchdog output, ssh
# noise and no output are idle (return 1).
busy_reason() {
  [[ "$1" == "busy: "* ]] || return 1
  echo "${1#busy: }"
}
