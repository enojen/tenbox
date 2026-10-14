# no-state-literal-compare

No `x.state`, `x.status` or `x.kind` compared with `===` / `!==` to a string literal. Compare
with the named constant of the module that makes the state, such as `PR_STATE.created` or
`BUILD_STATUS.needsYou`. Tests are excluded in `biome.json`: they assert the JSON output.

Why: a state string typed in two places drifts apart without a type error when the value
changes, and a search for the constant finds every place that reads the state. Added in
TEN-397.
