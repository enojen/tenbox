export const meta = {
  name: 'tenbox-build',
  description: 'Build, check and review one Tenbox task, round after round, until it passes or needs you',
  whenToUse: 'In a task worktree after the plan is approved. args: the task id, or { task, feedback, maxRounds }.',
  phases: [{ title: 'Build' }, { title: 'Checks' }, { title: 'Review' }],
}

const input = typeof args === 'string' ? { task: args } : (args ?? {})
const task = input.task
if (!task) throw new Error('args: the task id, for example "TEN-301"')
const maxRounds = input.maxRounds ?? 3
const LENSES = ['correctness', 'fit to the plan, the spec and the project glossary; repeated code', 'security and data safety']

const PARTS = {
  type: 'object',
  properties: {
    parts: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, goal: { type: 'string' } }, required: ['id', 'goal'] },
    },
  },
  required: ['parts'],
}
const BUILT = {
  type: 'object',
  properties: {
    status: { enum: ['done', 'blocked'] },
    commit: { type: 'string' },
    questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['status'],
}
// Only the fields the loop reads; the full result is in .tenbox/rounds/N/checks.json.
const CHECKS = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, summary: { type: 'string' }, error: { type: 'string' } },
  required: ['ok'],
}
const REVIEW = {
  type: 'object',
  properties: {
    must_fix: { type: 'array', items: { type: 'string' } },
    nice_to_have: { type: 'array', items: { type: 'string' } },
    attention: { type: 'array', items: { type: 'string' } },
  },
  required: ['must_fix', 'nice_to_have', 'attention'],
}

let feedback = input.feedback ?? 'none'
for (let round = 1; round <= maxRounds; round++) {
  phase('Build')
  const { parts } = await agent(`Task ${task}, round ${round}. List the parts still to build, and the done parts this feedback asks to change. Round feedback: ${feedback}`,
    { agentType: 'planner', schema: PARTS, phase: 'Build', label: `round ${round}: parts` })
  // One after another: without separate worktrees, parallel workers would edit the same tree.
  for (const part of parts) {
    const built = await agent(`Task ${task}, part ${part.id}: ${part.goal}. Round feedback: ${feedback}`,
      { agentType: 'worker', schema: BUILT, phase: 'Build', label: `round ${round}: ${part.id}` })
    if (!built || built.status === 'blocked') return { status: 'needs-you', round, part: part.id, questions: built?.questions ?? [] }
  }

  phase('Checks')
  const checks = await agent(`Run \`tenbox check ${task} --round ${round}\` and return its JSON.`,
    { agentType: 'runner', schema: CHECKS, phase: 'Checks', label: `round ${round}: checks` })
  if (!checks?.ok) {
    feedback = checks?.summary ?? checks?.error ?? 'tenbox check failed'
    continue
  }

  phase('Review')
  const reviews = (await parallel(LENSES.map((lens) => () =>
    agent(`Review task ${task} through this lens: ${lens}.`,
      { agentType: 'reviewer', schema: REVIEW, phase: 'Review', label: `round ${round}: ${lens}` })))).filter(Boolean)
  const mustFix = reviews.flatMap((r) => r.must_fix)
  if (mustFix.length) {
    feedback = mustFix.join('\n')
    continue
  }
  return {
    status: 'ready-for-you',
    round,
    attention: reviews.flatMap((r) => r.attention),
    nice_to_have: reviews.flatMap((r) => r.nice_to_have),
  }
}
return { status: 'failed', rounds: maxRounds, feedback }
