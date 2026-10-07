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
    parts: { type: 'array', items: { type: 'string' } },
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
  required: ['summary', 'parts', 'criteria', 'lenses', 'questions'],
}

return agent(`Task ${task}. Write the plan: .tenbox/plan.md, the part files and .tenbox/questions.md.`,
  { agentType: 'planner', schema: PLAN, label: 'plan', ...(input.deep ? { model: DEEP_MODEL } : {}) })
