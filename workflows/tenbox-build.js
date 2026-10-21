export const meta = {
  name: 'tenbox-build',
  description: 'Build, check and review one Tenbox task, round after round, until it passes or needs you',
  whenToUse: 'In a task worktree after the plan is approved; `tenbox build <id>` starts it. args: { task, kind, reviews, parts, lenses, groups, feedback, maxRounds, answer }, or that object as JSON text.',
  phases: [{ title: 'Build' }, { title: 'Checks' }, { title: 'Review' }],
}

// `tenbox build` sends the plan as JSON text; `tenbox answer` resumes with the object.
const input = typeof args === 'string' && args.trim().startsWith('{') ? JSON.parse(args) : (args ?? {})
const task = typeof input === 'string' ? input : input.task
if (!task || !Array.isArray(input.parts)) {
  throw new Error(`args: the parts and lenses of plan.json are missing; start it with \`tenbox build ${task ?? '<id>'}\``)
}
const maxRounds = input.maxRounds ?? 3
// The review rounds of each scope, as the task kind gives them; a raised kind gives more.
let reviewCap = input.reviews ?? maxRounds
// `tenbox answer` resumes the run with { round, part, option, text }. Only that worker's prompt
// changes, so every earlier agent returns from the resume cache.
const answer = input.answer
const answerLine = (round, partId) => answer && answer.round === round && answer.part === partId
  ? `\nYour decision card is answered: option ${answer.option}: ${answer.text}`
  : ''
// Roles run on their frontmatter model; a hard part and a strong lens get this one.
const STRONG_MODEL = 'opus'
const strongModelIf = (needed) => (needed ? { model: STRONG_MODEL } : {})

// The base lens always runs; the planner adds the others per task in plan.json.
const LENSES = {
  base: { text: 'correctness, fit to the plan and the spec, the project glossary, repeated code' },
  security: { text: 'security and data safety', strong: true },
  contract: { text: 'API and other contract changes, backwards compatibility' },
}

// Copy of BUILD_STATUS in domain/build.ts (a workflow cannot import TypeScript).
const BUILD_STATUS = {
  readyForYou: 'ready-for-you',
  needsYou: 'needs-you',
  failed: 'failed',
}
// The worker statuses in agents/worker.md (no TypeScript source).
const WORKER_STATUS = { done: 'done', blocked: 'blocked' }

const PART_LIST = {
  type: 'array',
  items: {
    type: 'object',
    properties: { id: { type: 'string' }, goal: { type: 'string' }, difficulty: { enum: ['easy', 'hard'] } },
    required: ['id', 'goal', 'difficulty'],
  },
}
const LENS_LIST = { type: 'array', items: { enum: ['security', 'contract'] } }
// Round 1 takes the parts from the args; a later round asks the planner.
const PARTS = {
  type: 'object',
  properties: { parts: PART_LIST, lenses: LENS_LIST },
  required: ['parts', 'lenses'],
}
const GROUP_PARTS = { type: 'object', properties: { parts: PART_LIST }, required: ['parts'] }
// `worktree` comes only from the CLI: without it the command did not run.
const WORKTREE = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, worktree: { type: 'string' }, error: { type: 'string' } },
  required: ['ok'],
}
// Only the fields the loop reads; the full result is in .tenbox/rounds/N/checks.json.
// `commit` and `file` come only from the CLI: without them the command did not run.
const CHECKS = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    commit: { type: 'string' },
    round: { type: 'integer' },
    file: { type: 'string' },
    summary: { type: 'string' },
    error: { type: 'string' },
  },
  required: ['ok'],
}
// `tenbox part done`: `commit` comes only from the CLI; without it the command did not run.
const PART_DONE = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, commit: { type: 'string' }, error: { type: 'string' } },
  required: ['ok'],
}
const NON_BLANK = { type: 'string', pattern: '\\S' }
const BUILT = {
  type: 'object',
  properties: {
    status: { enum: Object.values(WORKER_STATUS) },
    commit: { type: 'string' },
    // A blocked worker's question; `recommended` is the 1-based number of one of the options.
    decision: {
      type: 'object',
      properties: {
        title: NON_BLANK,
        options: { type: 'array', items: NON_BLANK, minItems: 1 },
        recommended: { type: 'integer', minimum: 1 },
        reason: { type: 'string' },
        auto: { type: 'boolean' },
        kind: { enum: ['migration', 'data-delete', 'feature-delete', 'contract', 'paid-service', 'locked-file', 'scope', 'other'] },
      },
      required: ['title', 'options', 'recommended', 'reason', 'auto', 'kind'],
    },
    proofs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: NON_BLANK, test: NON_BLANK, failure: NON_BLANK },
        required: ['file', 'test', 'failure'],
      },
    },
    // The JSON of the worker's `tenbox part done` and of its last `tenbox check`.
    partDone: PART_DONE,
    checks: CHECKS,
  },
  required: ['status', 'proofs'],
}
const MAX_NICE_TO_HAVE = 3
const REVIEW = {
  type: 'object',
  properties: {
    must_fix: { type: 'array', items: { type: 'string' } },
    nice_to_have: { type: 'array', items: { type: 'string' }, maxItems: MAX_NICE_TO_HAVE },
    attention: { type: 'array', items: { type: 'string' } },
    unproven: {
      type: 'array',
      items: { type: 'object', properties: { part: { type: 'string' }, reason: { type: 'string' } }, required: ['part', 'reason'] },
    },
  },
  required: ['must_fix', 'nice_to_have', 'attention', 'unproven'],
}

// A ready build opens the draft PR in `tenbox build done`; a failed one shows in `pr.ok`.
const PR = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    groups: { type: 'array', items: { type: 'object' } },
    error: { type: 'string' },
  },
  required: ['ok'],
}
// Every end status goes through `tenbox build done`; `recorded` is its JSON.
// A refusal has `code`, and `check-failed` has the group and the tier in `details`.
const RECORDED = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    file: { type: 'string' },
    error: { type: 'string' },
    code: { type: 'string' },
    // `kind-raised` has the new kind, its lenses and its review rounds in `details`.
    details: {
      type: 'object',
      properties: {
        group: { type: 'integer' },
        tier: { type: 'string' },
        kind: { type: 'string' },
        lenses: LENS_LIST,
        reviews: { type: 'integer' },
      },
    },
    pr: PR,
  },
  required: ['ok'],
}
// Every reviewed round's attention items, each with where it came from; `record` merges them.
const attentionItems = []
// Rounds that ran a review, over every scope: one round's items need no merge.
let reviewedRounds = 0
const ATTENTION = {
  type: 'object',
  properties: { attention: { type: 'array', items: { type: 'string' } } },
  required: ['attention'],
}
const attentionLine = (item) => `- round ${item.round}, lens ${item.lens}, worktree ${item.worktree ?? 'task worktree'}: ${item.text}`
// One item per hunk: a null reply keeps the raw texts.
const mergeAttention = async () => {
  if (!attentionItems.length || reviewedRounds < 2) return attentionItems.map((item) => item.text)
  const merged = await agent(
    `Merge the attention items below of task ${task} into one item per hunk.\n${attentionItems.map(attentionLine).join('\n')}\n`
    + 'Merge items of the same file and topic into one item that names its lenses. '
    + "Keep an item of an earlier round only when its hunk is still in the last round's diff: check it with git diff in the item's worktree. "
    + 'When you are not sure two items are the same hunk, keep both. Return the merged items as attention.',
    { agentType: 'reviewer', schema: ATTENTION, phase: 'Review', label: 'merge attention' })
  return merged?.attention ?? attentionItems.map((item) => item.text)
}
// A quoted heredoc: a quote in the text cannot break the shell.
const recordBuild = (result) => agent(
  `Run this command and return its JSON:\n\ntenbox build done ${task} --json "$(cat <<'EOF'\n${JSON.stringify(result)}\nEOF\n)"`,
  { agentType: 'runner', schema: RECORDED, phase: 'Build', label: 'record build' })
// The kind `tenbox build done` raised the build to, and its refusal texts as attention lines.
let raisedKind = null
const raisedAttention = []
const record = async (end) => {
  const attention = [...await mergeAttention(), ...raisedAttention]
  const result = { round: 0, proofs: [], nice_to_have: [], unproven: [], ...end, ...collected(), attention, ...(raisedKind && { kind: raisedKind }) }
  return { ...result, recorded: await recordBuild(result) }
}
// `tenbox build done` checks a ready build: a red full tier is one more round of its group,
// and a diff over the limits of its kind is one more round of every scope with the new review.
const redFullTier = (done) => done.recorded?.code === 'check-failed' && done.recorded.details?.tier === 'full'
const kindRaised = (done) => done.recorded?.code === 'kind-raised'
// Any other refusal of a ready build is recorded as failed, with the refusal as feedback.
const finish = async (done) => {
  if (done.status !== BUILD_STATUS.readyForYou || done.recorded?.ok) return done
  const { recorded, ...ready } = done
  const failed = { ...ready, status: BUILD_STATUS.failed, feedback: recorded?.error ?? 'tenbox build done did not run' }
  return { ...failed, recorded: await recordBuild(failed) }
}

// Every round's unproven items: a part caught once keeps its -1 even when the fix lands.
const unproven = []
// Every reviewed round's nice_to_have items: a scoped review no longer sees older hunks.
const niceToHave = []
// Every round's worker proofs, each with its part id; `tenbox close` counts them.
const proofs = []
const proofLines = () => proofs.map((p) => `- part ${p.part}: ${p.file} > ${p.test}: got ${p.failure}`).join('\n') || 'none'
const collected = () => ({ nice_to_have: niceToHave, unproven, proofs })

// `reviewedCommit` is the checks commit of the last round that ran a review; a feedback round reviews only the lines after it.
// `reviews` counts the scope's reviewed rounds.
const TASK_SCOPE = { group: null, worktree: null, tag: '', checkFlag: '', reviewedCommit: null, reviews: 0 }
const groupScope = (group, worktree) => ({ group, worktree, tag: `g${group.id} `, checkFlag: ` --group ${group.id}`, reviewedCommit: null, reviews: 0 })
const worktreeLine = (scope) => scope.worktree
  ? `\nWork in the group worktree ${scope.worktree}: run every command and edit every file there.`
  : ''
const ownCommitsLine = (scope) => scope.group?.needs.length
  ? `\nThis group starts on the work of groups ${scope.group.needs.join(', ')}: review only its own commits, after \`start\` in .tenbox/groups/${scope.group.id}/group.json.`
  : ''
// Without a recipe, roles run on their frontmatter model and a hard part gets the strong one.
const workerModel = (scope, part) => scope.group
  ? { model: scope.group.recipe.model, effort: scope.group.recipe.effort }
  : strongModelIf(part.difficulty === 'hard')

const listParts = async (scope, round, feedback) => {
  if (!scope.group) {
    return agent(`Task ${task}, round ${round}. List the parts still to build, and the done parts this feedback asks to change, and the extra review lenses. Round feedback: ${feedback}`,
      { agentType: 'planner', schema: PARTS, phase: 'Build', label: `round ${round}: parts` })
  }
  const { parts } = await agent(`Task ${task}, group ${scope.group.id}, round ${round}. List the parts still to build in group ${scope.group.id}, and the done parts of that group this feedback asks to change. Round feedback: ${feedback}`,
    { agentType: 'planner', schema: GROUP_PARTS, phase: 'Build', label: `round ${round}: ${scope.tag}parts` })
  return { parts, lenses: scope.group.recipe.lenses }
}

// A must_fix round needs no planner: one worker fixes every item of the round feedback.
const FIX_GOAL = 'fix every must_fix item of the round feedback. It has no part file: stay inside the files of the parts the items name'
const fixListing = (lenses) => ({ parts: [{ id: 'fix', goal: FIX_GOAL, difficulty: 'easy' }], lenses })

// `start` is the first round, its feedback, and its listing of parts and lenses when the args give one.
const buildRounds = async (scope, start) => {
  let feedback = start.feedback
  let listing = start.listing
  const scopeLine = () => scope.reviewedCommit
    ? `\nThis is a feedback round: review only the lines changed since ${scope.reviewedCommit}: \`git diff ${scope.reviewedCommit}..HEAD\`.`
    : ''
  // `checkRound` is the round number of the first check; later checks of the round reuse it.
  const checkCommand = (checkRound) => `tenbox check ${task}${scope.checkFlag}${checkRound ? ` --round ${checkRound}` : ''}`
  // A plan part has no goal: the worker reads its part file.
  const partLine = (part) => `Task ${task}, part ${part.id}${part.goal ? `: ${part.goal}` : ''}.`
  // The checks commit of the scope's last green part: `tenbox part done` accepts only a newer commit.
  let lastChecksCommit = null
  const partDoneCommand = (part) => `tenbox part done ${task} --part ${part.id} --commit <hash of your last commit>${lastChecksCommit ? ` --since ${lastChecksCommit}` : ''}${scope.checkFlag}`
  // A worker builds one part, then runs `tenbox part done` and its check; a fix attempt carries what failed and reopens the part file.
  const buildPart = async (round, part, { attempt, failure, checkRound }) => {
    const fix = attempt === 'fix'
    const prompt = fix
      ? `${partLine(part)} ${failure.what}: ${failure.why}\nSet \`status: todo\` in your part file first, then fix it.`
      : `${partLine(part)} Round feedback: ${feedback}${answerLine(round, part.id)}`
    const commandLine = `\nAfter your last commit, run \`${partDoneCommand(part)}\` and return its JSON as partDone, then run \`${checkCommand(checkRound)}\` and return its JSON as checks.`
    const built = await agent(prompt + commandLine + worktreeLine(scope),
      { agentType: 'worker', schema: BUILT, phase: 'Build', label: `round ${round}: ${scope.tag}${part.id}${fix ? ' fix' : ''}`, ...workerModel(scope, part) })
    proofs.push(...(built?.proofs ?? []).map((proof) => ({ ...proof, part: part.id })))
    if (built && built.status !== WORKER_STATUS.blocked) return { partDone: built.partDone ?? null, checks: built.checks ?? null }
    return { end: { status: BUILD_STATUS.needsYou, round, part: part.id, ...(built?.decision && { decision: built.decision }) } }
  }
  // Why a worker's attempt is not done, or null; a refused commit is reported before a red check.
  const partFailure = (built) => {
    if (!partDoneOk(built.partDone)) return { what: 'The commit of this part was refused', why: built.partDone?.error ?? 'tenbox part done did not run' }
    if (!checksGreen(built.checks)) return { what: 'The check of this part failed', why: checksSummary(built.checks) }
    return null
  }
  for (let round = start.round; round <= maxRounds; round++) {
    phase('Build')
    const { parts, lenses } = listing ?? await listParts(scope, round, feedback)
    listing = null
    // One after another: the parts of one scope share one worktree.
    // A refused commit or a red check gives the worker one fix in the same round.
    let checkRound = null
    let checks = null
    let redFeedback = null
    for (const part of parts) {
      const first = await buildPart(round, part, { attempt: 'build', failure: null, checkRound })
      if (first.end) return first.end
      checks = first.checks
      checkRound = checks?.round ?? checkRound
      let failure = partFailure(first)
      if (failure) {
        const fixed = await buildPart(round, part, { attempt: 'fix', failure, checkRound })
        if (fixed.end) return fixed.end
        checks = fixed.checks
        checkRound = checks?.round ?? checkRound
        failure = partFailure(fixed)
      }
      if (failure) {
        redFeedback = `part ${part.id}: ${failure.why}`
        break
      }
      lastChecksCommit = checks.commit
    }
    if (redFeedback) {
      feedback = redFeedback
      continue
    }
    if (!parts.length) {
      checks = await agent(`Run \`${checkCommand(null)}\` and return its JSON.`,
        { agentType: 'runner', schema: CHECKS, phase: 'Checks', label: `round ${round}: ${scope.tag}checks` })
    }
    if (!checksGreen(checks)) {
      feedback = checksSummary(checks)
      continue
    }
    // After the last allowed review, a must_fix round ends with its green checks.
    if (scope.reviews >= reviewCap) return { status: BUILD_STATUS.readyForYou, round }

    phase('Review')
    const reviews = (await parallel(['base', ...lenses].map((key) => async () => {
      const review = await agent(`Review task ${task} through this lens: ${LENSES[key].text}.\nWorker proofs so far:\n${proofLines()}${scopeLine()}${worktreeLine(scope)}${ownCommitsLine(scope)}`,
        { agentType: 'reviewer', schema: REVIEW, phase: 'Review', label: `round ${round}: ${scope.tag}${key}`, ...strongModelIf(LENSES[key].strong) })
      return review && { ...review, lens: key }
    }))).filter(Boolean)
    // One -1 per part per round, however many lenses name it.
    const roundParts = new Set()
    for (const item of reviews.flatMap((r) => r.unproven)) {
      if (roundParts.has(item.part)) continue
      roundParts.add(item.part)
      unproven.push(item)
    }
    scope.reviewedCommit = checks.commit
    scope.reviews += 1
    reviewedRounds += 1
    for (const r of reviews) attentionItems.push(...r.attention.map((text) => ({ round, lens: r.lens, worktree: scope.worktree, text })))
    niceToHave.push(...reviews.flatMap((r) => r.nice_to_have))
    const mustFix = reviews.flatMap((r) => r.must_fix)
    if (mustFix.length) {
      feedback = mustFix.join('\n')
      listing = fixListing(lenses)
      continue
    }
    return { status: BUILD_STATUS.readyForYou, round }
  }
  return { status: BUILD_STATUS.failed, round: maxRounds, feedback }
}

const firstStart = (listing) => ({ round: 1, feedback: input.feedback ?? 'none', listing })
// Each group's scope, so a red full tier can give that group one more round.
const scopes = new Map()
// Group 1 is the task worktree, where this session runs.
const openWorktree = (group) => group.id === 1
  ? { ok: true, worktree: null }
  : agent(`Run \`tenbox worktree ${task} --group ${group.id}\` and return its JSON.`,
    { agentType: 'runner', schema: WORKTREE, phase: 'Build', label: `round 1: g${group.id} worktree` })
const WAITING = 'waiting'
const buildGroup = async (group, runs) => {
  const needs = await Promise.all(group.needs.map((id) => runs.get(id)))
  if (needs.some((end) => end.status !== BUILD_STATUS.readyForYou)) return { status: WAITING }
  const opened = await openWorktree(group)
  if (!opened?.ok || opened.worktree === undefined) {
    return { status: BUILD_STATUS.failed, round: 0, feedback: opened?.error ?? 'tenbox worktree did not run' }
  }
  const scope = groupScope(group, opened.worktree)
  scopes.set(group.id, scope)
  const parts = input.parts.filter((part) => group.parts.includes(part.id))
  return buildRounds(scope, firstStart({ parts, lenses: group.recipe.lenses }))
}
// needs-you wins with the lowest such group, then failed, else every group is ready-for-you.
const groupsEnd = (groups, ends) => {
  const asking = ends.find((end) => end.status === BUILD_STATUS.needsYou)
  if (asking) return asking
  const round = Math.max(0, ...ends.map((end) => end.round ?? 0))
  const failed = groups.filter((_, i) => ends[i].status === BUILD_STATUS.failed)
  if (!failed.length) return { status: BUILD_STATUS.readyForYou, round }
  const feedback = failed.map((group) => `group ${group.id}: ${ends[groups.indexOf(group)].feedback}`).join('\n')
  return { status: BUILD_STATUS.failed, round, feedback }
}
const buildGroups = async (groups) => {
  // A group needs only smaller ids, so every need's run exists before the group starts.
  const runs = new Map()
  for (const group of groups) runs.set(group.id, buildGroup(group, runs))
  return groupsEnd(groups, await Promise.all(groups.map((group) => runs.get(group.id))))
}

const partDoneOk = (partDone) => Boolean(partDone?.ok && partDone.commit)
const checksGreen = (checks) => Boolean(checks?.ok && checks.commit && checks.file)
const checksSummary = (checks) => checks?.summary ?? checks?.error ?? 'tenbox check did not run'
const groups = input.groups ?? []
const end = groups.length
  ? await buildGroups(groups)
  : await buildRounds(TASK_SCOPE, firstStart({ parts: input.parts, lenses: input.lenses ?? [] }))
const fullTierRound = (done) => {
  const scope = scopes.get(done.recorded.details.group) ?? TASK_SCOPE
  return buildRounds(scope, { round: done.round + 1, feedback: done.recorded.error, listing: null })
}
// The new lenses never saw the diff: each scope reviews all of it again, with no parts to build.
const raiseKind = async (done) => {
  const { error, details } = done.recorded
  raisedKind = details.kind
  reviewCap = details.reviews
  raisedAttention.push(error)
  const start = { round: done.round + 1, feedback: error, listing: { parts: [], lenses: details.lenses } }
  const rerun = (scope) => {
    scope.reviewedCommit = null
    return buildRounds(scope, start)
  }
  if (!groups.length) return rerun(TASK_SCOPE)
  return groupsEnd(groups, await Promise.all(groups.map((group) => rerun(scopes.get(group.id)))))
}
let done = await record(end)
while (redFullTier(done) || kindRaised(done)) {
  done = await record(await (redFullTier(done) ? fullTierRound(done) : raiseKind(done)))
}
return finish(done)
