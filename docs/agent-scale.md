# Tenbox at agent scale

Working notes, 2026-10-13. Target: 40 PRs a day with one human reviewer. Not today's
behaviour; each numbered item becomes its own task when it is agreed.

Source of the numbers: task `123qmzr0hwk` (Core local hardening), 384 minutes from
`tenbox start` to `tenbox close`, measured from `stats.json` and the round files.

| where the time went                      | minutes | share |
| ---------------------------------------- | ------- | ----- |
| scenario runs (7 full runs, 12–17 min)   | ~115    | 30%   |
| waiting for a human decision (needs-you) | ~85     | 22%   |
| PR review and 8 stacked merges           | 77      | 20%   |
| agent work (plan, workers, reviewers)    | ~60     | 16%   |
| checks (10 rounds, unit 72 s)            | ~15     | 4%    |
| rest (approval wait, setup)              | ~30     | 8%    |

The arithmetic for 40 PRs a day: one reviewer, 8 hours, 12 minutes per PR with nothing
else. Reading every line is impossible. The human reads intent; the tools carry the proof.

Reference: Anthropic, "Redesigning source control at Anthropic" (2026-10-13). What
applies here is not Scion itself but five ideas: review by intent, no serial merge queue,
post-merge testing, hermetic simulation, and an agent that watches one component.

## 1. Review by intent (agreed 2026-10-13)

Decisions:

- The **reviewer writes the intent card**, not the worker. The worker describes its own
  work favourably; the reviewer describes it critically.
- **`docs` and `test-only` PRs merge automatically** once the checks are green. `fake`
  stays manual for now; open it after a week of reading its cards.
- **`logic` and above get proof verification** (revert the fix, run the test, see red).

### 1.1 The intent card

The PR body stops being the plan text. It becomes one card the human reads instead of the
diff. Example for PR #89 of the hardening task:

```
What changed
  limit_reached once per episode; the limit count takes an advisory lock per connection;
  shop/redact revokes a live shop before deleting its rows.
Why
  L11: two alerts 4 ms apart. L12: 251 of 250 sent. S12: the poll delivered a shop's
  orders again after shop/redact.
Proof
  outbound.test.ts "two sends race…"        red: expected 2 to be 1 → green
  connections.test.ts "opens once"          red: 2 alerts → green
  poller.test.ts "after shop/redact"        red: length 2 → green
  scenario 140: sent 250 held 250 (was 251/249)
Risk class: logic
Attention (the human reads these hunks)
  outbound.ts:161  the advisory lock is held across the Meta HTTP call; one lane per number
  shopify.ts:142   shop_redact now raises connection_lost; backends see a new behaviour
Reading: 2 hunks, ~30 lines
```

Sources: "What/Why" from the reviewer's reading of the part results and the diff;
"Proof" from `proofs.json`; "Attention" from the reviewer's `attention` list (already a
rule-based list today). New fields: `intent` (3 lines), `risk_class`, hunk count.

### 1.2 Risk class

One label per PR. First by path rule, then the reviewer confirms. The highest class in
the diff wins: one migration line makes the whole PR `migration`. The reviewer may raise
the class, never lower it. That closes the hole where an agent labels logic as test-only.

| class               | path rule                                                         | gate                         |
| ------------------- | ----------------------------------------------------------------- | ---------------------------- |
| `docs`              | only `*.md`                                                       | checks green → auto merge    |
| `test-only`         | only `*.test.ts`, scenario scripts                                | checks green → auto merge    |
| `fake`              | `apps/fake-*/`                                                    | manual for now, card only    |
| `logic`             | product code under `src/`                                         | human reads the card         |
| `migration`         | `drizzle/`, `schema/`                                             | card + hunks line by line    |
| `external-contract` | provider clients, OpenAPI, `wire-client` events, env contracts    | card + hunks line by line    |
| `shared`            | `packages/*` used by another app (e.g. #88 touched booking-be)      | card + list of affected apps |

Class rules are per project and live in `tenbox.yaml` (`risk:` section), the defaults
above come from Tenbox.

### 1.3 Proof rule, tightened

Today: "red test first" is a worker rule, the reviewer counts `unproven`, close scores it
−1 per part. When the human no longer reads the lines, the proof is the only guarantee,
so:

- A proof carries the red failure (today) **and** the green run output (new).
- `tenbox proof --verify`: Tenbox reverts the fix commit in a throwaway worktree, runs the
  one test, expects red, restores, runs again, expects green. Not the reviewer's word.
  Runs for `logic` and above only (unit sweep is 72 s; one test is seconds).
- A `logic` PR without a verified proof is not opened. Today it only loses a point.

### 1.4 What the human does

Not a PR list: an **inbox** of cards sorted by class. `docs`/`test-only` appear as
already-merged info lines. A `logic` card has two actions: **land** or **send back: <one
sentence>**. Send back opens a feedback round for the worker (today this is a hand-written
`.tenbox/rounds/N/feedback.md`).

Time budget per card: `logic` 2 min, `migration`/`external-contract` 10 min. 40 PRs a
day ≈ 25 logic × 2 + 5 heavy × 10 ≈ 100 minutes.

### 1.5 Changes in Tenbox

- `agents/reviewer.md`: new output fields `intent` (what/why, 3 lines), `risk_class`,
  and a hunk/line count on `attention`.
- `domain/pr.ts` `prBody`: the card instead of the plan text.
- `tenbox pr`: label and draft/ready by class.
- new `tenbox land <id>`: class rule + green checks → squash merge; `logic` and above
  wait for the human's land.
- `tenbox proof --verify`: revert-and-run.
- `tenbox.yaml` `risk:` section for the path rules.

Guard from the article: "the role of the engineers was to tell Claude no". The class is
set by the reviewer, not the worker; `migration` and `external-contract` never merge
automatically.

## 2. No serial merge queue (agreed 2026-10-13)

Decisions:

- **The planner defines the PR groups** at plan time; the human sees them at plan
  approval. Not derived from file overlap at `tenbox pr` time: the planner knows the
  400-line rule, a file-overlap heuristic does not.
- **Wait model for dependent groups**: a dependent PR opens only after its dependency has
  landed. No stacked PRs, no base retargeting.
- **First week the human lands everything**, auto classes included. `auto` is a label on
  the card, not a trigger. The `tenbox watch` loop that lands `docs`/`test-only` by itself
  comes after a week of trust.

### 2.1 Today

- One task = one branch `feat/<id>`, parts = commits, `tenbox pr` opens one PR.
- The 400-line rule forces hand-made stacks: cherry-pick per group, then six manual steps
  per merge (PATCH the next PR's base first, rebase `--onto`, force-push with lease,
  delete the branch, clean the worktree, `close --force`). Deleting the base branch
  before retargeting auto-closed a PR twice (#78 in gab, #83 in hwk).
- `tenbox close` looks the PR up by branch name, so stacks need `--force`.

### 2.2 Groups in the plan

The planner already lists files per part. New `groups:` section in `plan.md`: a group is
one or more parts and becomes one PR. Two groups are independent when their file lists do
not overlap and no `needs:` is written; otherwise dependent.

```
groups:
  - id: 1   parts: [01]      base: main          # fake-shopify controls
  - id: 2   parts: [02]      base: main          # fake-meta controls
  - id: 3   parts: [03]      needs: [1, 2]       # scenarios
  - id: 5   parts: [05a]     base: main          # timeout, backoff, limit field
  - id: 8   parts: [05d]     needs: [5, 6]
```

In the hardening task the planner wrote this split in prose ("PR split: …") and Tenbox
did not read it.

### 2.3 One branch per group, wait model

Branch `feat/<id>-<group>`. An independent group branches off main. A dependent group is
written on top of the branch it needs (the worker needs that code), but **its PR is not
opened until the dependency has landed**. On land, Tenbox rebases the dependent branch
onto the new main and opens its PR then. No base changes, no auto-closed PRs, no stale
commits in the diff. Cost: the dependent PR is seen later. With intent cards that does not
matter; the human reads cards in order anyway.

### 2.4 `tenbox land <id> [--group N]`

One command instead of six steps:

1. rebase the branch onto main (conflict → 2.5)
2. run the `fast` checks
3. squash merge; the Conventional Commits title comes from the group name
4. rebase the groups that need this one onto the new main, open their waiting PRs
5. delete the branch
6. `merge-check` on main (item 5)

Who runs it: the human, from the inbox card ("land"). Later: `tenbox watch` for `docs`
and `test-only` once checks are green.

### 2.5 Conflicts belong to the worker

A rebase conflict opens a "rebase round": the worker resolves it, runs the checks, and the
proofs must still be green. The reviewer reads only the conflicting hunks. The human never
sees it.

### 2.6 Close by group

A task closes when every group has landed. PRs are found by the `tenbox: <id> group N`
line in the PR body, not by branch name. No `--force`, no "reset the branch to main
first" recipe.

### 2.7 Changes in Tenbox

- `agents/planner.md`: `groups:` section with `parts`, `base`/`needs`, a name per group.
- `tenbox pr`: one PR per landable group; dependent groups wait.
- new `tenbox land <id> [--group N]`.
- `tenbox close`: group-based, PR lookup by body line.
- `tenbox build`: workers of independent groups may run in parallel (item 7).

## 3. Notify on needs-you, continue by default (agreed 2026-10-13)

Decisions:

- **Automatic continue after 30 minutes** from day one, not after a trust week. The
  human's words: full speed.
- Notification channel: ntfy on the dev box (task text stays inside) plus `notify-send`
  on the laptop. Not decided explicitly; default until the human says otherwise.

Why: 72 minutes lost today between round 7 stopping on the L12 question and the human
noticing. In the same task the worker asked four decisions and the human took the
recommended option every time.

### 3.1 Notification

`tenbox.yaml` gets a `notify:` section (ntfy topic URL, desktop on/off). Tenbox sends on:
round ends `needs-you` or `ready-for-you`, PR opened, checks red, land done, land
conflict. One line each, with the task id and the next action.

### 3.2 Decision card

A `needs-you` is no longer free text. The worker (or the build workflow) writes:

```
decision: L12 limit overshoot
  1. fix with an advisory lock per connection   (recommended: a real Meta constraint)
  2. widen the scenario to accept +1
  continues with 1 after 30 min
```

Fields: title, options, recommended option with a one-sentence reason, deadline.

### 3.3 What automatic continue does

After the deadline with no answer, Tenbox tells the worker "continue with the recommended
option" and the build goes on: red test, fix, checks, round close. It records the choice
in `decisions.md` as `auto` and the card in the inbox shows "automatic decision: option 1,
no answer in 30 min". The human can still send the card back ("send back: option 2"),
which opens a feedback round that undoes the fix.

Automatic continue does nothing else: it does not open a PR, does not land, does not
touch main. The result still arrives as a card.

Cost of a wrong default: one worker round, about 10 minutes of agent time. Decisions that
never continue automatically, they wait without a deadline: a migration, a deletion of
data or of a feature, an external contract change, a paid service, anything in `locked`.

### 3.4 `tenbox wait --for round`

Today `--for build` returns as soon as `build.json` exists, useless after round 1. New:
wait for the next round change, return its status as JSON. An outside agent blocks on
this instead of polling.

### 3.5 Changes in Tenbox

- `tenbox.yaml` `notify:`; `infra/notify.ts` (one HTTP POST, one `notify-send`).
- `agents/worker.md` and the build workflow: the decision card format; the worker must
  name a recommended option.
- Build workflow: deadline timer, `auto` decision record, the never-auto list.
- `tenbox wait --for round`.

## 4. Tiered test runs (agreed 2026-10-13)

Decisions:

- **`full` runs once, at round close**, before `ready-for-you`. Land runs `fast` only;
  `full` again only when the land rebase had a conflict.
- **The hermetic layer is the next item (4b)**, planned now, not later. The human's
  words: this is where we lose the most time.

### 4.1 Two tiers in `tenbox.yaml`

```
checks:
  fast: [lint, lint-new, unused, dup-new, build, unit, scenarios-touched]
  full: [scenarios]
```

`fast` every round. `full` once at round close. `fast` at land (item 2.4). `full` at the
deploy gate (item 5).

### 4.2 `scenarios-touched`

The scenario runner gets `--only 140,150`. Which scenarios a round touched: the planner
writes `scenarios:` per part (today part 05 named them in prose), and a worker fix adds
its scenario number to the proof. The filter is that list.

### 4.3 Back-to-back runs

One 16-minute run was wasted today on leftover state. The runner resets the databases and
the fakes at start and unpauses `my-app-db` if a killed run left it paused. A small task
on the project side, not in Tenbox.

## 4b. Hermetic scenarios (to plan next)

Goal: the logic scenarios run in seconds, in one process, with no clock and no network.
Today 40 scenarios take 12–17 minutes because they use real processes, real ports, a real
Postgres container, a 5 s poll interval and a real 3-minute outage.

What becomes hermetic:

- wire, wire-worker, core-be, fake-shopify and fake-meta started in one Node process as
  Hono apps with `app.request()` or an in-memory fetch, no ports.
- Postgres → PGlite (already used in unit tests: `openTestPGlite`), one instance per
  scenario, migrations applied once and snapshotted.
- Clock → a fake clock injected into the outbox runners, the poller and the backoff
  (the unit tests already inject `now`); "wait 3 minutes" becomes `clock.advance(3 min)`
  plus one tick.
- Poll interval 5 s → tick on demand: a scenario calls `tick()` instead of sleeping.

What stays real (`full` tier): SIGTERM/SIGKILL mid-burst, Postgres pause, health 503
under outage, port binding, the load numbers (seconds to last message, webhook max ms).
Those measure the real stack and keep their meaning only there.

Expected: ~30 of 40 scenarios hermetic, under one minute in total; `full` keeps ~10
scenarios, about 8 minutes. Round cost drops from 16 minutes to seconds; `fast` can then
run the whole hermetic set every round, so `scenarios-touched` matters less.

### 4b.1 What already exists (checked 2026-10-13 in my-app)

- Every runner takes `now`: `createOutbound`, `createDeliveries`, `createShopifyPoller`,
  `createOutboxRunner` all have `now?: () => Date`.
- Every outbound HTTP call takes `fetch`: `createMetaClient({ fetch })`,
  `createGraphqlClient({ fetch })`, wire's test app takes `fetch` for the backend call.
- Wire already runs in one process in `apps/wire/src/e2e.test.ts`: `createTestDb()`
  (PGlite), `createTestApp(t, { now, fetch })`, a fake Meta client, a Hono stub as the
  backend. The hermetic layer is this test's shape, generalised.
- fake-meta and fake-shopify are factories (`createFakeMeta(deps)`,
  `createFakeShopify(deps)`) returning Hono apps; `app.request()` needs no port.
- core-be is `createApp(deps)` with the wire routes injected.
- The scenario scripts never import the apps. They call `fetch(new URL(path, baseUrl))`
  through `ctx` (`context.mjs`, `wire-api.mjs`, `fake-controls.mjs`).

Missing:

- The runners expose `start()`/`stop()` (a `setInterval` on `pollMs`) but no `tick()`.
- `ctx` builds its own `fetch`; it has to take one.
- The "wait until" helpers (`phoneUntil`, `until(count)`) poll real time.

### 4b.2 Design

One scenario, two contexts. The scenario files do not change.

- `ctx.fetch`: the real context passes `globalThis.fetch`; the hermetic context passes a
  router that maps the host of the URL to a Hono app in memory
  (`fake-shopify.local` → `fakeShopify.request`, `wire.local` → `wire.request`, …).
  Because wire's Meta and Shopify clients and core-be's wire client all take `fetch`,
  the same router is injected into them. No port, no network anywhere.
- `ctx.clock`: `{ now(), advance(ms) }`. The hermetic context injects `now` into every
  runner and both fakes. "core-be down for 3 minutes" becomes `clock.advance(3 min)`.
- `ctx.tick()`: runs one pass of every runner (wire outbound, wire deliveries, shopify
  poller, core-be notify outbox) in dependency order. The runners get a `pass()`
  method next to `start()`; `start()` keeps calling `pass()` on the interval.
- `ctx.until(predicate)`: real context polls the clock; hermetic context loops
  `tick()` + `clock.advance(pollMs)` up to N times, then fails with the state it saw.
- Database: `createTestDb()` from `@my-app/pglite-testing` per scenario, migrations
  applied once and the PGlite data dir copied (snapshot) so each scenario starts in
  milliseconds.
- Desk: the hermetic wire uses the dev gate (`devGate: { org }`) like the e2e test; no
  desk app, no login.

### 4b.3 Which scenarios go where

| tier     | files                                              | count | why                              |
| -------- | -------------------------------------------------- | ----- | -------------------------------- |
| hermetic | 10 20 30 40 50 70 80 90 100 110 120 130            | ~30   | logic, order, counts, alerts     |
| full     | 140 load, 150 outages, 60 core-down (drain secs) | ~10   | real processes, signals, seconds |

A hermetic scenario reports counts and order only. Every measured number in the hardening
table (seconds, max ms, pool errors) stays a `full`-tier result.

### 4b.4 Parts (one Tenbox task, PRs ≤ 400 lines)

1. `pass()` on `createOutboxRunner` and the three wire runners plus core-be's outbox;
   `start()` becomes "call `pass()` on the interval". Red test: a runner with
   `pollMs: Infinity` delivers nothing until `pass()` is called.
2. `ctx` takes `fetch`, `clock`, `tick`, `until`; the real context keeps today's
   behaviour (no scenario changes; `pnpm core:scenarios` output identical).
3. `createHermeticContext()`: in-memory router, PGlite per scenario, dev gate, both fakes
   in process, snapshot of the migrated database.
4. `pnpm core:scenarios --hermetic` runs the hermetic tier; `--full` runs everything
   on the real stack (today's behaviour); default = hermetic. Acceptance: the hermetic
   tier passes in under 60 s; `full` still 40/40.
5. `tenbox.yaml` in my-app: `fast` includes `pnpm core:scenarios` (hermetic),
   `full` is `--full`.

### 4b.5 What lives where (agreed 2026-10-13)

The hermetic **mechanism** is per project; the hermetic **rule** is in Tenbox.

Per project (my-app, `scripts/dev/scenarios/hermetic.mjs`): which factories,
which deps, the host → app router table, the `tick()` order, the PGlite snapshot, which
scenarios stay `full`. Tenbox cannot know any of this.

In Tenbox:

1. The tier contract: `checks: { fast, full }` in `tenbox.yaml`, `fast` every round,
   `full` once at round close (item 4.1).
2. The rule in the agent prompts. `planner.md`: a change of behaviour is proven by a unit
   test or a hermetic scenario; a real-stack run happens only at round close.
   `worker.md`: run scenarios through the `fast` tier, never call `full` yourself.
   Today the worker ran `full` three times in one round because no rule said otherwise.
3. A guide, `docs/hermetic.md`: how to make a project's scenarios hermetic. The
   project-free half of 4b.2: `now` and `fetch` injection, `pass()` on runners, host →
   app router, database snapshot, "a hermetic run reports no measured seconds". The
   planner reads it when the project declares scenarios.
4. Measurement: scenario seconds per round in `stats.json`.

How the agent reads the design: the hermetic task's tracker text carries 4b, and the
design file is copied into `.tenbox/` at `tenbox start` (as `hardening-docs.md` was for
the hardening task). The guide (3) comes through the planner prompt in every project.

Two tasks: one in my-app (the five parts of 4b.4), one small one in Tenbox (tiers,
prompt rule, guide, stats). The Tenbox one is independent and can go first.

### 4b.6 Open points

- Scenario 50 (connections) drives the OAuth redirect chain with `redirect: "manual"`;
  the in-memory router must return the 302 untouched. Check `app.request` does.
- 100-shopify-retries replays a webhook "with the same Webhook-Id"; the fake keeps state
  in memory, fine in process.
- Postgres advisory lock (`pg_advisory_xact_lock`, item L12) must work on PGlite; verify
  in part 3, else that one scenario stays `full`.
- Order of `tick()` matters for "exactly once" scenarios; document it in the context.

## 5. Post-merge testing (agreed 2026-10-13)

Decisions:

- **Revert, not fix-forward**: a red main is reverted at once; the fix comes as a new
  land. "main is always green" (project CLAUDE.md) stays true.
- **`tenbox merge-check` keeps its pre-merge mode**, run by hand; `tenbox land` does not
  call it.
- **Deploy goes to the last green `full` sha**, from a daily `full` run, so a deploy
  never waits for a scenario run.

### 5.1 Today

`tenbox merge-check` merges every open task PR onto main in a temporary worktree and
runs setup and every check there, before the merge. Useful by hand; at 40 PRs a day it
would be a queue (N PRs merged, 72 s unit sweep, per land).

### 5.2 Land gate is small

`tenbox land` runs `fast` on the branch itself (item 2.4), not on the merge with every
other open change. Concurrent lands may conflict in behaviour; that is what 5.3 is for.

### 5.3 Main runs after each land

After a land, Tenbox runs `fast` on the new tip of main (`tenbox merge-check --landed`).
Back-to-back lands do not pile up: one run on the latest tip.

Red → automatic revert: Tenbox knows which lands sit between the last green tip and this
one (usually one). It opens a revert branch, lands it like a `test-only` PR (no checks:
it returns to a tip known green), notifies, and opens a fix round on the task that broke
main. The worker undoes the revert and fixes; the result lands again through the normal
path.

### 5.4 Deploy gate

`tenbox gate full` runs the `full` tier on main once a day (cron) and records the sha.
The deploy script deploys that sha, not the tip. A `full` run can be started by hand
before an urgent deploy.

### 5.5 GitHub CI

Informational. The gate is the local check. If CI billing is fixed, CI can run `full` on
main and feed 5.4; it never blocks a land.

### 5.6 Changes in Tenbox

- `tenbox land`: call `merge-check --landed` after the merge.
- `tenbox merge-check --landed`: run `fast` on `origin/main` tip; record green tips.
- Revert path: branch, land, notify, fix round.
- `tenbox gate full` + green-sha record read by the project's deploy script.

## 6. Worktree setup cost (measured 2026-10-13, no action)

Measured on a fresh worktree of my-app at `origin/main`:

| step                          | seconds |
| ----------------------------- | ------- |
| `git worktree add`            | 0.2     |
| `pnpm install --frozen-lockfile` (675 MB node_modules, store hardlinks) | 3.5 |
| first `pnpm -r build`         | 1.2     |

Not a bottleneck; nothing to do. The article's "new worktree 7.1 min → 5 s" is a
100 GB monorepo problem, not ours. Only change: `stats.json` records `setup` seconds so
this stays visible if the repo grows.

## 7. Parallel workers (agreed 2026-10-13)

Decision: **one worktree per group**, `~/wt/<project>/<id>-<group>`. Setup is 5 seconds
(item 6); node_modules are store hardlinks, so the disk cost is small.

- Parts 01, 02, 03 ran one after another today, eight minutes apart, with disjoint file
  lists. The build workflow calls the workers in sequence.
- The `groups:` section (item 2.2) already says which groups are independent. The build
  workflow starts the workers of independent groups at the same time; a dependent group
  starts when the group it needs is done, in that group's worktree chain.
- Each group has its own branch and its own worktree, so parallel workers never share a
  working tree; `git add -A` cannot pick up another worker's files. The single-worktree
  alternative was rejected as fragile.
- Checks: a worker runs only the tests it touched (project rule) in its own worktree;
  the full `fast` tier runs once at round close. `scripts/test.sh` keeps its flock so two
  sweeps never run at once on the laptop.
- One reviewer per group, in parallel.
- Expected: ~15 minutes on the hardening task; more on tasks with more independent
  groups.

## 8. Component watcher (agreed 2026-10-13)

Decision: after the dev e2e task (`123qmzr0gaf`), on the dev box, **wire first**.

- One agent whose only job is to watch one component (the article's "superfan"). A
  Claude Code session or a cron-triggered skill on the dev box. It reads wire's logs
  (`wire.outbound.*`, `wire.deliveries.*`, `tick_failed`), `/health`, `/metrics`, the
  `wire_alerts` table and Beszel.
- It does one thing: one ntfy line when something looks wrong. It changes no code and
  restarts no service. This is the "alert first, then fix from data" rule.
- "Wrong" means: a log line outside the known error classes, a sudden rise of noise
  (`status_skipped`), delivery lag above its usual value, a counter stuck at zero (no
  `sent` for an hour while the queue grows).
- Not a Tenbox feature; it belongs to the project. Tenbox's only part: what the watcher
  finds becomes a tracker task and enters through `tenbox start`.

## 9. Stats (agreed 2026-10-13, first Tenbox task)

Decision: **this is the first Tenbox task** of this document. Without the measurement the
effect of items 1–7 cannot be seen.

- `stats.json` records minutes per phase but no tokens. The Claude Code transcripts under
  `~/.claude/projects/<worktree>/` hold per-call usage. The hardening task: 1023 calls,
  88k output tokens (Opus 63k, Sonnet 25k), 6.2M cache write, 80.9M cache read.
- `tenbox stats <id>`: join `stats.json` with the transcripts. Output: minutes and tokens
  per round; calls and tokens per agent (planner, worker, reviewer) and per model.
- Agent label: the transcript files are named `wf_…`; the workflow starts agents with a
  `label` (`review:bugs`, `worker:03`). Check whether the label is written into the
  transcript; if so read it, else infer from the first message.
- The same file gets the measurements of items 4 and 6: scenario seconds per round,
  setup seconds.
- `tenbox close` adds one line to the tracker comment: "384 min, 88k tokens, 10 rounds".
  Over time this shows what each kind of task costs.
- Later: `tenbox stats` across tasks, so the before/after of each item in this document
  is a number, not a guess.

## 10. Dynamic workflows (researched 2026-10-13, to discuss)

Today's three scripts (`tenbox-plan.js`, `tenbox-build.js`, `tenbox-close.js`) are the
same for every task: three phases, `maxRounds = 3`, a fixed lens list, workers in
sequence, Opus for `hard` parts, one planner call with nobody checking the plan, and the
whole workflow restarted by a human typing `/tenbox-build <id>` into tmux.

What the Claude Code docs and the installed CLI offer (sources: code.claude.com/docs
`workflows`, `sub-agents`, `hooks`, `headless`, `scheduled-tasks`, `routines`,
`agent-sdk/typescript`, `monitoring-usage`; the local `workflow-authoring` reference for
`budget`, `workflow()`, `resumeFromRunId`, `journal.jsonl`, `isolation`, `effort`).

### 10.1 The plan drives the shape of the build

The planner already returns parts, difficulty and lenses. Extend that to a **build
recipe** per group: model, effort, lenses, review depth (single reviewer / adversarial
votes / loop-until-dry), check tier, parallel yes/no. `tenbox-build.js` stays one script
but reads the recipe; nothing is hard-coded per task any more.

- `agent(prompt, { model, effort, isolation: 'worktree', agentType, schema })`: model and
  effort per call exist today; `effort: 'low'` for runners, `'high'` only for the judge
  of a `migration` or `external-contract` group.
- Risk class (item 1.2) → lenses: `docs` no reviewer; `test-only` base only; `logic`
  base; `migration`/`external-contract`/`shared` base + security + contract + a 3-vote
  adversarial pass on each must_fix (the quality patterns in the reference).
- `budget` global (`budget.total`, `remaining()`): review depth scales to the token
  target instead of a constant.

### 10.2 Groups flow through a pipeline

`pipeline(groups, build, check, review)` instead of `for (part of parts)`: group A is in
review while group B still builds, no barrier. Each worker gets `isolation: 'worktree'`
(one worktree per group, item 7). Dependent groups wait for their dependency inside the
pipeline stage.

### 10.3 Sub-workflows

`workflow(name, args)` nests one level. Split `tenbox-build.js` into `tenbox-group`
(build + check + review of one group), `tenbox-review` (lenses + adversarial), and a
thin top script the planner's recipe composes. Each piece is testable on its own.

### 10.4 Resume instead of restart

`Workflow({ scriptPath, resumeFromRunId })`: unchanged `agent()` calls return their
cached result. After a `needs-you`, the continuation re-runs only from the decision
on. Today a feedback round starts the whole workflow again. `journal.jsonl` holds every
agent's return value; item 9's `tenbox stats` reads it instead of parsing transcripts.

### 10.5 Build without tmux

`claude -p "/tenbox-build <id>" --output-format json --max-budget-usd N
--allowedTools Workflow` runs a workflow with no human typing; the run stays open until
the workflow ends and the JSON result carries `total_cost_usd` and a per-model
breakdown (item 9 for free). `claude --bg` + `claude attach` / `claude logs` replace
the tmux session for watching. `tenbox build <id>` spawns this itself; `tenbox wait`
becomes "wait for the process".

Automatic continue (item 3.3) needs a timer the script cannot hold (`Date.now()` is
not available in scripts). The timer lives in the Tenbox CLI: `needs-you` → notify →
after 30 min `claude -p` again with `resumeFromRunId` and the recommended option as
feedback.

### 10.6 Hooks enforce the rules instead of the prompt

Subagent frontmatter `hooks` run only while that subagent runs. Rules that today are
sentences in `worker.md` become mechanical:

- `PreToolUse` on `Bash`, matcher `pnpm core:scenarios` without `--only`/hermetic →
  `deny` with the reason (item 4: the worker never runs `full`).
- `PreToolUse` on `Bash` `git push` / `gh pr` in a worker → `deny` (the CLI pushes).
- `PostToolUse` on `Bash` `git commit` in a worker → record the commit in the round.
- `SubagentStop` / `PostToolUse` matcher `Workflow` → `type: "http"` POST to ntfy
  (item 3). `TaskCompleted` for the same.

### 10.7 Agent memory

Subagent frontmatter `memory: project` gives the reviewer a project-scoped memory across
tasks: the findings it raised before, the `attention` items the human accepted. Worth a
trial on the reviewer only; a worker with memory would carry old assumptions.

### 10.8 Single-agent steps as skills

`tenbox-plan` and `tenbox-close` are one `agent()` call each. A skill with
`context: fork` and `agent: planner` does the same with less machinery; workflows stay
for multi-agent steps.

### 10.9 Not documented, do not build on

A routine or cron starting a saved workflow; subagent resume across sessions; a hook
event for a workflow phase; per-agent token budget (`taskBudget` exists in the SDK,
details unread). Routines (cloud, GitHub-event trigger) could run the post-land check
of item 5 outside the laptop, but a cloud session has no dev box and no Docker Postgres;
only the unit part of `fast` would run there.

### 10.10 Order

1. 10.5 `claude -p` build + JSON cost → feeds item 9.
2. 10.4 resume after needs-you.
3. 10.1 recipe from the planner, 10.2 pipeline over groups (with item 2 and 7).
4. 10.6 hooks for the worker rules and ntfy.
5. 10.3 sub-workflows, 10.7 reviewer memory, 10.8 skills: when the above is stable.

### 10.11 tmux (agreed 2026-10-13)

tmux goes as the trigger and the decision channel, stays optional as a window.
`tenbox start` opens no tmux; `tenbox build` starts `claude --bg`; `tenbox attach <id>`
is a shortcut to `claude attach`; `tenbox answer <id> <option>` resumes with the
decision. Whether typing into an attached `-p` session works is not documented; try it.

## 11. Code quality that improves from the human's reviews (to discuss)

### 11.1 What exists in my-app

Biome `recommended` plus: no magic numbers, no non-null assertion, no nested ternary, no
default export, 200 lines per file, no `any`, `useAwait`, no `forEach`, cognitive
complexity, unused imports/variables/parameters. Nine GritQL plugins in `biome-rules/`
(six enabled: await at statement start, named parameter types, no JSON round-trip, no
inline cast, no `new PGlite`, no foreign tenant name). Knip for unused files and
dependencies, jscpd for copied blocks (10+ lines, one side in a new workspace), ESLint
`boundaries` and the Mastra import ban, tsconfig `strict` + `noUncheckedIndexedAccess` +
`exactOptionalPropertyTypes`. The reviewer agent carries "code shape rules" in its prompt.

This is already a strong gate. What is missing is the loop from the human's review notes
back into the gate.

### 11.2 The human's notes, measured

26 inline review comments on PRs #58, #59, #60 (2026-10-13), by kind:

| kind                                                    | count | can become            |
| ------------------------------------------------------- | ----- | --------------------- |
| "string literal instead of the enum/const" (kinds, status, provider, event names, `"CANCELLED"`) | 6 | GritQL rule |
| "why is this here, it belongs to package X" (shopify in wire, shopify in booking-be)       | 5 | `boundaries` rule |
| "what is this file/function, I do not understand it"                                    | 6 | intent card + naming rule in reviewer |
| "repeated code, make a package" (graphql client, pg client, enums)                       | 4 | jscpd threshold + reviewer lens "repeated across apps" |
| "is there a package for this, why by hand" (phone, graphql)                              | 2 | reviewer checklist: library first |
| other (constants placement, graceful shutdown fits infra)                                | 3 | project checklist |

About 11 of 26 are mechanical. Each one caught by a rule is a note the human never writes
again and a round the worker never needs.

### 11.3 The loop

1. **Collect.** `tenbox land` (or close) pulls the PR's inline review comments through
   `gh api` into `.tenbox/review-notes.json`: file, line, text, and what the worker
   changed in answer (the next commit touching that line).
2. **Classify.** A `distill` agent reads the notes of the last N tasks and sorts each
   into: `rule` (a GritQL/Biome/boundaries/Knip rule can catch it), `checklist` (a line
   for `reviewer.md`), `glossary` (a name or a concept for the project `CLAUDE.md`),
   `once` (no pattern). It never guesses a rule from one note: a `rule` needs the same
   kind twice.
3. **Propose.** For `rule`, the agent writes the `.grit` file plus a test fixture that
   fails on the original line from the note and passes on the worker's fix; opens a
   `test-only`-class PR to `biome-rules/`. For `checklist` and `glossary`, a PR to
   `reviewer.md` / `CLAUDE.md`. The human lands them like any PR.
4. **Measure.** Per task in `stats.json`: notes per PR, must_fix the human overrode,
   rule PRs landed. The target is notes per PR going down while PRs per day go up. If
   notes per PR do not fall, the loop is not working, whatever the rule count says.

The soft version of the same loop is reviewer `memory: project` (10.7): the reviewer
remembers the notes. The hard version is the rule PR: the gate remembers them. Prefer
the rule; use memory only for what a rule cannot express.

### 11.4 Rules to write first (from the 26 notes)

- GritQL `no-status-literal`: a comparison of a field named `status`, `kind`, `provider`,
  `event` with a string literal → use the enum/const from the schema or the client.
- `boundaries`: `packages/shopify` owns Shopify; `apps/wire` imports it, never defines
  Shopify types; `apps/booking-be` never names Shopify. Same shape for Meta/WhatsApp.
- jscpd: lower the block size for `packages/*` so a copied client (graphql, pg) shows
  earlier; Knip already reports unused exports after the extraction.
- Reviewer checklist: "a hand-written parser or validator for a format a maintained
  library parses (phone numbers, GraphQL) is a must_fix"; "a file or function whose name
  does not say what it does is a must_fix (the human asked 'what is this' six times)".

### 11.5 Other tools worth adding

- **Stryker (mutation testing) on changed files only**, for `logic` and above: it
  answers the question the proof rule cannot ("does this test fail when the logic is
  wrong?"). Expensive on the whole repo, cheap on a diff. Run in `full`, report a
  per-PR mutation score on the card.
- Biome `noRestrictedImports` as the Biome-side twin of the ESLint boundaries, so the
  rule survives if ESLint is dropped.
- `knip --production` in `full` to catch dev-only dependencies that leak into runtime.
- Not worth it now: dependency-cruiser (boundaries covers it), type-coverage (`strict`
  already), SonarQube (duplicates Biome + jscpd).

### 11.6 Changes in Tenbox

- `tenbox land`/`close`: collect review notes into `.tenbox/review-notes.json`.
- new agent `distill` (reads notes, proposes rules); `tenbox distill [--last N]`.
- `stats.json`: notes per PR, overridden must_fix, rule PRs.
- `reviewer.md`: the two checklist lines from 11.4.

## Order of work (agreed 2026-10-13)

How to open the tasks from this file (Tenbox tracker is Linear, see `tenbox.yaml`):

1. Open one Linear issue per row of the table below. Title: `Tenbox: <delivers, short>`.
   Description: the item numbers, the "delivers" cell, and a line
   `Spec: docs/agent-scale.md items <numbers>`. Issue A has no dependency; B blocks on A,
   C on B, D on C, E on D, F on D.
2. `tenbox start <issue A>` on this repo. The planner reads this file in the task worktree
   (`docs/agent-scale.md` is committed on `main`); it plans only the items named in the
   issue and treats every other item as context.
3. One PR per task, squash merged by the human, then `tenbox close`, then the next row.

The my-app rows are opened in ClickUp (Product list), not here.

| task | items | delivers |
| ---- | ----- | -------- |
| A | 9, 10.5, 10.11 | `tenbox stats <id>` (minutes + tokens per round and agent, from `stats.json` + `journal.jsonl` + transcripts); `tenbox build` runs `claude --bg` with `--output-format json --max-budget-usd`, no tmux; `tenbox attach`; cost line in the close comment |
| B | 10.4, 3, 4.1 | resume after `needs-you` (`resumeFromRunId`); `notify:` in `tenbox.yaml` (ntfy + notify-send); decision card format; `tenbox answer <id> <n>`; automatic continue after 30 min with the never-auto list; `checks: { fast, full }`, `full` once at round close; `tenbox wait --for round` |
| C | 2, 10.1, 10.2, 7 | planner `groups:` with `base`/`needs` and the build recipe (model, effort, lenses, review depth, tier); one branch and one worktree per group; `pipeline` over groups, independent groups in parallel; wait model for dependent PRs; `tenbox land <id> [--group N]`; close by group; PR lookup by body line |
| D | 1, 10.6 | reviewer writes the intent card (`intent`, `risk_class`, hunk count); `risk:` path rules in `tenbox.yaml`, highest class wins, reviewer may only raise; `docs`/`test-only` marked `auto`; `tenbox proof --verify` (revert-and-run) required for `logic` and above; PR body = card; worker hooks: deny `full` scenarios, deny `git push`/`gh pr`, record commits; ntfy on `SubagentStop`/Workflow end |
| E | 5 | `merge-check --landed` after each land; revert path (branch, land, notify, fix round); `tenbox gate full` daily + green-sha record for deploy |
| F | 11 | review-notes collection at land (`gh api` + fix diff); `distill` agent with the two-notes rule; rule PRs with red/good fixtures and a whole-repo count; `checklist`/`glossary` PRs; `tenbox note`; notes-per-PR and rules-landed in stats; first rules: `no-status-literal`, Shopify/Meta boundaries, jscpd threshold, two reviewer lines; Stryker on changed files in `full` |
| later | 10.3, 10.7, 10.8 | sub-workflows, reviewer `memory: project`, plan/close as forked skills |

my-app tasks:

| task | items | when |
| ---- | ----- | ---- |
| hermetic scenarios | 4b (five parts) + 4.3 | now, in parallel with the dev e2e task |
| wire watcher | 8 | after the dev e2e task |
| small debts | status_skipped log level, runner leaves `my-app-db` paused, `LimitReachedInput.at` type, 131042 decision, dedupe hash with phone, core-be `failed` on 401/403 | when the human opens them |

## Expected effect, measured on the hardening task

| item                      | now  | after |
| ------------------------- | ---- | ----- |
| scenario runs             | 115  | ~45   |
| waiting for a decision    | 85   | ~20   |
| PR review and merges      | 77   | ~25   |
| agent work                | 60   | ~45   |
| total                     | 384  | ~150  |

Items 1 and 2 are the lever for 40 PRs a day; the rest shorten the clock but do not
change how much the human can read.
