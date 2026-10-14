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

const PARTS = {
  type: 'object',
  properties: {
    parts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, goal: { type: 'string' }, difficulty: { enum: ['easy', 'hard'] } },
        required: ['id', 'goal', 'difficulty'],
      },
    },
    lenses: { type: 'array', items: { enum: ['security', 'contract'] } },
  },
  required: ['parts', 'lenses'],
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
      },
      required: ['title', 'options', 'recommended', 'reason', 'auto'],
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
const finish = async (result) => {
  const full = { round: 0, proofs: [], attention: [], nice_to_have: [], unproven: [], ...result }
  // A quoted heredoc: a quote in the text cannot break the shell.
  const recorded = await agent(
    `Run this command and return its JSON:\n\ntenbox build done ${task} --json "$(cat <<'EOF'\n${JSON.stringify(full)}\nEOF\n)"`,
    { agentType: 'runner', schema: RECORDED, phase: 'Build', label: 'record build' })
  return { ...full, recorded }
}

phase('Build')
const approved = await agent(`Run \`tenbox approved ${task}\` and return its JSON.`,
  { agentType: 'runner', schema: APPROVED, phase: 'Build', label: 'approval' })
if (!approved?.ok || !approved.file) {
  return finish({ status: BUILD_STATUS.notApproved, error: approved?.error ?? 'tenbox approved did not run' })
}

let feedback = input.feedback ?? 'none'
// Every round's unproven items: a part caught once keeps its -1 even when the fix lands.
const unproven = []
// Every reviewed round's attention and nice_to_have items: a scoped review no longer sees older hunks.
const attention = []
const niceToHave = []
// The checks commit of the last round that ran a review; a feedback round reviews only the lines after it.
let reviewedCommit = null
const scopeLine = () => reviewedCommit
  ? `\nThis is a feedback round: review only the lines changed since ${reviewedCommit}: \`git diff ${reviewedCommit}..HEAD\`.`
  : ''
// Every round's worker proofs, each with its part id; `tenbox close` counts them.
const proofs = []
const proofLines = () => proofs.map((p) => `- part ${p.part}: ${p.file} > ${p.test}: got ${p.failure}`).join('\n') || 'none'
// A worker builds one part; a fix attempt carries the red check summary and reopens the part file.
const buildPart = async (round, part, { attempt, summary }) => {
  const fix = attempt === 'fix'
  const prompt = fix
    ? `Task ${task}, part ${part.id}: ${part.goal}. The check of this part failed: ${summary}\nSet \`status: todo\` in your part file first, then fix it.`
    : `Task ${task}, part ${part.id}: ${part.goal}. Round feedback: ${feedback}${answerLine(round, part.id)}`
  const built = await agent(prompt,
    { agentType: 'worker', schema: BUILT, phase: 'Build', label: `round ${round}: ${part.id}${fix ? ' fix' : ''}`, ...strongModelIf(part.difficulty === 'hard') })
  proofs.push(...(built?.proofs ?? []).map((proof) => ({ ...proof, part: part.id })))
  if (built && built.status !== WORKER_STATUS.blocked) return {}
  return { end: await finish({ status: BUILD_STATUS.needsYou, round, part: part.id, ...(built?.decision && { decision: built.decision }), attention, nice_to_have: niceToHave, unproven, proofs }) }
}
// `checkRound` is the round number of the first check; later checks of the round reuse it.
const runChecks = (round, label, checkRound) => agent(
  `Run \`tenbox check ${task}${checkRound ? ` --round ${checkRound}` : ''}\` and return its JSON.`,
  { agentType: 'runner', schema: CHECKS, phase: 'Checks', label: `round ${round}: ${label}` })
const checksGreen = (checks) => Boolean(checks?.ok && checks.commit && checks.file)
const checksSummary = (checks) => checks?.summary ?? checks?.error ?? 'tenbox check did not run'
for (let round = 1; round <= maxRounds; round++) {
  phase('Build')
  const { parts, lenses } = await agent(`Task ${task}, round ${round}. List the parts still to build, and the done parts this feedback asks to change, and the extra review lenses. Round feedback: ${feedback}`,
    { agentType: 'planner', schema: PARTS, phase: 'Build', label: `round ${round}: parts` })
  // One after another: without separate worktrees, parallel workers would edit the same tree.
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
    agent(`Review task ${task} through this lens: ${LENSES[key].text}.\nWorker proofs so far:\n${proofLines()}${scopeLine()}`,
      { agentType: 'reviewer', schema: REVIEW, phase: 'Review', label: `round ${round}: ${key}`, ...strongModelIf(LENSES[key].strong) })))).filter(Boolean)
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
  phase('Checks')
  const full = await agent(`Run \`tenbox check ${task} --tier full --round ${round}\` and return its JSON.`,
    { agentType: 'runner', schema: CHECKS, phase: 'Checks', label: `round ${round}: full checks` })
  if (!full?.ok) {
    feedback = full?.summary ?? full?.error ?? 'tenbox check --tier full did not run'
    continue
  }
  return finish({
    status: BUILD_STATUS.readyForYou,
    round,
    attention,
    nice_to_have: niceToHave,
    unproven,
    proofs,
  })
}
return finish({ status: BUILD_STATUS.failed, round: maxRounds, feedback, attention, nice_to_have: niceToHave, unproven, proofs })
