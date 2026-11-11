# Handing a lane to the next session

- The lane file is the only thing the next session has. Keep it true at each change of state,
  not at the end.
- Before a handover, write into "Next step": the open spoken decisions, the running Jobs, and
  the last raw error text when a step failed.
- A handover cannot carry what the session learned by reading code. Put the two or three facts
  the next session needs into the card notes: the file, the line, the rule.
- The next session starts with `/tenbox-babysitter <name>` and nothing else. After the start it
  asks the cluster again (`tenbox machine ls`, `tenbox status`) and does not trust a Job name in
  the file alone.
