export const meta = {
  name: 'tenbox-plan',
  description: 'Plan one Tenbox task: plan.md with parts, criteria and questions',
  whenToUse: 'In a task worktree after `tenbox start`. args: the task id, or { task, deep: true } for a hard task.',
}

const input = typeof args === 'string' ? { task: args } : (args ?? {})
const task = input.task
if (!task) throw new Error('args: the task id, for example "TEN-301"')
// The planner runs on its frontmatter model; `deep` asks for the strongest one.
const DEEP_MODEL = 'fable'

const PLAN = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    estimated_lines: { type: 'integer', minimum: 0 },
    // id is the two-digit part number of the part file, for example "01"
    parts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, difficulty: { enum: ['easy', 'hard'] } },
        required: ['id', 'difficulty'],
      },
    },
    criteria: { type: 'array', items: { type: 'string' } },
    lenses: { type: 'array', items: { enum: ['security', 'contract'] } },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { enum: ['technical', 'product', 'contract', 'risk'] },
          text: { type: 'string' },
          blocking: { type: 'boolean' },
        },
        required: ['kind', 'text', 'blocking'],
      },
    },
  },
  required: ['summary', 'estimated_lines', 'parts', 'criteria', 'lenses', 'questions'],
}

// `file` comes only from the CLI; `code` and `error` say why plan.json was not written.
const RECORDED = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    file: { type: 'string' },
    code: { type: 'string' },
    error: { type: 'string' },
  },
  required: ['ok'],
}

const plan = await agent(`Task ${task}. Write the plan: .tenbox/plan.md, the part files and .tenbox/questions.md.`,
  { agentType: 'planner', schema: PLAN, label: 'plan', ...(input.deep ? { model: DEEP_MODEL } : {}) })

// A quoted heredoc: a quote in the summary cannot break the shell.
const recorded = await agent(
  `Run this command and return its JSON:\n\ntenbox plan done ${task} --json "$(cat <<'EOF'\n${JSON.stringify(plan)}\nEOF\n)"`,
  { agentType: 'runner', schema: RECORDED, label: 'record plan' })

return { ...plan, recorded }
