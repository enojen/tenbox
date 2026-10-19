export const meta = {
  name: 'tenbox-build',
  description: 'Build, check and review one Tenbox task, round after round, until it passes or needs you',
  whenToUse: 'In a task worktree after the plan is approved. args: the task id, or { task, feedback, maxRounds, answer }.',
  phases: [{ title: 'Build' }, { title: 'Checks' }, { title: 'Review' }],
}

const input = typeof args === 'string' ? { task: args } : (args ?? {})
const task = input.task
if (!task) throw new Error('args: the task id, for example "TEN-301"')
const maxRounds = input.maxRounds ?? 3
// `tenbox answer` resumes the run with { round, part, option, text }. Only that worker's prompt
// changes, so every earlier agent returns from the resume cache.
const answer = input.answer
const answerLine = (round, partId) => answer && answer.round === round && answer.part === partId
  ? `\nYour decision card is answered: option ${answer.option}: ${answer.text}`
  : ''
// Roles run on their frontmatter model; a hard part and a strong lens get this one.
const STRONG_MODEL = 'opus'
const strongModelIf = (needed) => (needed ? { model: STRONG_MODEL } : {})

// The base lens always runs; the planner adds the others per task in plan.md.
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
  notApproved: 'not-approved',
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
const GROUP = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    name: { type: 'string' },
    needs: { type: 'array', items: { type: 'integer' } },
    recipe: {
      type: 'object',
      properties: {
        model: { enum: ['haiku', 'sonnet', 'opus', 'fable'] },
        effort: { enum: ['low', 'medium', 'high'] },
        lenses: LENS_LIST,
        tier: { enum: ['fast', 'full'] },
      },
      required: ['model', 'effort', 'lenses', 'tier'],
    },
  },
  required: ['id', 'name', 'needs', 'recipe'],
}
// Round 1 of the task also lists the groups, so a plan without groups needs no extra agent.
const PARTS = {
  type: 'object',
  properties: { parts: PART_LIST, lenses: LENS_LIST, groups: { type: 'array', items: GROUP } },
  required: ['parts', 'lenses'],
}
const GROUP_PARTS = { type: 'object', properties: { parts: PART_LIST }, required: ['parts'] }
// `worktree` comes only from the CLI: without it the command did not run.
const WORKTREE = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, worktree: { type: 'string' }, error: { type: 'string' } },
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
  },
  required: ['status', 'proofs'],
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

// The approval gate: `file` comes only from the CLI; without it the command did not run.
const APPROVED = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, file: { type: 'string' }, error: { type: 'string' } },
  required: ['ok'],
}
// Every end status goes through `tenbox build done`; `recorded` is its JSON.
const RECORDED = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, file: { type: 'string' }, error: { type: 'string' } },
  required: ['ok'],
}
// A ready build opens the PR; a failed `tenbox pr` keeps the status and shows in `pr.ok`.
const PR = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    groups: { type: 'array', items: { type: 'object' } },
    error: { type: 'string' },
  },
  required: ['ok'],
}
const finish = async (result) => {
  const full = { round: 0, proofs: [], attention: [], nice_to_have: [], unproven: [], ...result }
  // A quoted heredoc: a quote in the text cannot break the shell.
  const recorded = await agent(
    `Run this command and return its JSON:\n\ntenbox build done ${task} --json "$(cat <<'EOF'\n${JSON.stringify(full)}\nEOF\n)"`,
    { agentType: 'runner', schema: RECORDED, phase: 'Build', label: 'record build' })
  if (full.status !== BUILD_STATUS.readyForYou || !recorded?.ok) return { ...full, recorded }
  const pr = await agent(`Run \`tenbox pr ${task}\` and return its JSON.`,
    { agentType: 'runner', schema: PR, phase: 'Build', label: 'open pr' })
  return { ...full, recorded, pr }
}

phase('Build')
const approved = await agent(`Run \`tenbox approved ${task}\` and return its JSON.`,
  { agentType: 'runner', schema: APPROVED, phase: 'Build', label: 'approval' })
if (!approved?.ok || !approved.file) {
  return finish({ status: BUILD_STATUS.notApproved, error: approved?.error ?? 'tenbox approved did not run' })
}

// Every round's unproven items: a part caught once keeps its -1 even when the fix lands.
const unproven = []
// Every reviewed round's attention and nice_to_have items: a scoped review no longer sees older hunks.
const attention = []
const niceToHave = []
// Every round's worker proofs, each with its part id; `tenbox close` counts them.
const proofs = []
const proofLines = () => proofs.map((p) => `- part ${p.part}: ${p.file} > ${p.test}: got ${p.failure}`).join('\n') || 'none'
const collected = () => ({ attention, nice_to_have: niceToHave, unproven, proofs })

const TASK_SCOPE = { group: null, worktree: null, tag: '', checkFlag: '' }
const groupScope = (group, worktree) => ({ group, worktree, tag: `g${group.id} `, checkFlag: ` --group ${group.id}` })
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
    const groupsAsk = round === 1 ? ' Also list the groups of .tenbox/plan.json, an empty list when it has none.' : ''
    return agent(`Task ${task}, round ${round}. List the parts still to build, and the done parts this feedback asks to change, and the extra review lenses.${groupsAsk} Round feedback: ${feedback}`,
      { agentType: 'planner', schema: PARTS, phase: 'Build', label: `round ${round}: parts` })
  }
  const { parts } = await agent(`Task ${task}, group ${scope.group.id}, round ${round}. List the parts still to build in group ${scope.group.id}, and the done parts of that group this feedback asks to change. Round feedback: ${feedback}`,
    { agentType: 'planner', schema: GROUP_PARTS, phase: 'Build', label: `round ${round}: ${scope.tag}parts` })
  return { parts, lenses: scope.group.recipe.lenses }
}

const buildRounds = async (scope, listing) => {
  let feedback = input.feedback ?? 'none'
  // The checks commit of the last round that ran a review; a feedback round reviews only the lines after it.
  let reviewedCommit = null
  const scopeLine = () => reviewedCommit
    ? `\nThis is a feedback round: review only the lines changed since ${reviewedCommit}: \`git diff ${reviewedCommit}..HEAD\`.`
    : ''
  // A worker builds one part; a fix attempt carries the red check summary and reopens the part file.
  const buildPart = async (round, part, { attempt, summary }) => {
    const fix = attempt === 'fix'
    const prompt = fix
      ? `Task ${task}, part ${part.id}: ${part.goal}. The check of this part failed: ${summary}\nSet \`status: todo\` in your part file first, then fix it.`
      : `Task ${task}, part ${part.id}: ${part.goal}. Round feedback: ${feedback}${answerLine(round, part.id)}`
    const built = await agent(prompt + worktreeLine(scope),
      { agentType: 'worker', schema: BUILT, phase: 'Build', label: `round ${round}: ${scope.tag}${part.id}${fix ? ' fix' : ''}`, ...workerModel(scope, part) })
    proofs.push(...(built?.proofs ?? []).map((proof) => ({ ...proof, part: part.id })))
    if (built && built.status !== WORKER_STATUS.blocked) return {}
    return { end: { status: BUILD_STATUS.needsYou, round, part: part.id, ...(built?.decision && { decision: built.decision }) } }
  }
  // `checkRound` is the round number of the first check; later checks of the round reuse it.
  const runChecks = (round, label, checkRound) => agent(
    `Run \`tenbox check ${task}${scope.checkFlag}${checkRound ? ` --round ${checkRound}` : ''}\` and return its JSON.`,
    { agentType: 'runner', schema: CHECKS, phase: 'Checks', label: `round ${round}: ${scope.tag}${label}` })
  for (let round = 1; round <= maxRounds; round++) {
    phase('Build')
    const { parts, lenses } = round === 1 && listing ? listing : await listParts(scope, round, feedback)
    // One after another: the parts of one scope share one worktree.
    // A part's check runs at once; a red check gives its worker one fix in the same round.
    let checkRound = null
    let checks = null
    let redFeedback = null
    for (const part of parts) {
      const first = await buildPart(round, part, { attempt: 'build', summary: null })
      if (first.end) return first.end
      checks = await runChecks(round, `${part.id} check`, checkRound)
      checkRound = checks?.round ?? checkRound
      if (checksGreen(checks)) continue
      const fixed = await buildPart(round, part, { attempt: 'fix', summary: checksSummary(checks) })
      if (fixed.end) return fixed.end
      checks = await runChecks(round, `${part.id} check fix`, checkRound)
      checkRound = checks?.round ?? checkRound
      if (checksGreen(checks)) continue
      redFeedback = `part ${part.id}: ${checksSummary(checks)}`
      break
    }
    if (redFeedback) {
      feedback = redFeedback
      continue
    }
    if (!parts.length) checks = await runChecks(round, 'checks', null)
    if (!checksGreen(checks)) {
      feedback = checksSummary(checks)
      continue
    }

    phase('Review')
    const reviews = (await parallel(['base', ...lenses].map((key) => () =>
      agent(`Review task ${task} through this lens: ${LENSES[key].text}.\nWorker proofs so far:\n${proofLines()}${scopeLine()}${worktreeLine(scope)}${ownCommitsLine(scope)}`,
        { agentType: 'reviewer', schema: REVIEW, phase: 'Review', label: `round ${round}: ${scope.tag}${key}`, ...strongModelIf(LENSES[key].strong) })))).filter(Boolean)
    // One -1 per part per round, however many lenses name it.
    const roundParts = new Set()
    for (const item of reviews.flatMap((r) => r.unproven)) {
      if (roundParts.has(item.part)) continue
      roundParts.add(item.part)
      unproven.push(item)
    }
    reviewedCommit = checks.commit
    attention.push(...reviews.flatMap((r) => r.attention))
    niceToHave.push(...reviews.flatMap((r) => r.nice_to_have))
    const mustFix = reviews.flatMap((r) => r.must_fix)
    if (mustFix.length) {
      feedback = mustFix.join('\n')
      continue
    }
    if (scope.group?.recipe.tier === 'fast') return { status: BUILD_STATUS.readyForYou, round }
    phase('Checks')
    const full = await agent(`Run \`tenbox check ${task}${scope.checkFlag} --tier full --round ${round}\` and return its JSON.`,
      { agentType: 'runner', schema: CHECKS, phase: 'Checks', label: `round ${round}: ${scope.tag}full checks` })
    if (!full?.ok) {
      feedback = full?.summary ?? full?.error ?? 'tenbox check --tier full did not run'
      continue
    }
    return { status: BUILD_STATUS.readyForYou, round }
  }
  return { status: BUILD_STATUS.failed, round: maxRounds, feedback }
}

const WAITING = 'waiting'
const buildGroup = async (group, runs) => {
  const needs = await Promise.all(group.needs.map((id) => runs.get(id)))
  if (needs.some((end) => end.status !== BUILD_STATUS.readyForYou)) return { status: WAITING }
  const opened = await agent(`Run \`tenbox worktree ${task} --group ${group.id}\` and return its JSON.`,
    { agentType: 'runner', schema: WORKTREE, phase: 'Build', label: `round 1: g${group.id} worktree` })
  if (!opened?.ok || !opened.worktree) {
    return { status: BUILD_STATUS.failed, round: 0, feedback: opened?.error ?? 'tenbox worktree did not run' }
  }
  return buildRounds(groupScope(group, opened.worktree))
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

const checksGreen = (checks) => Boolean(checks?.ok && checks.commit && checks.file)
const checksSummary = (checks) => checks?.summary ?? checks?.error ?? 'tenbox check did not run'
const listing = await listParts(TASK_SCOPE, 1, input.feedback ?? 'none')
const groups = listing.groups ?? []
const end = groups.length ? await buildGroups(groups) : await buildRounds(TASK_SCOPE, listing)
return finish({ ...end, ...collected() })
