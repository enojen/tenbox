export const meta = {
  name: 'tenbox-plan',
  description: 'Plan one Tenbox task: plan.md with parts, criteria and questions',
  whenToUse: 'In a task worktree after `tenbox start`. args: the task id, for example "TEN-301".',
}

const task = typeof args === 'string' ? args : args?.task
if (!task) throw new Error('args: the task id, for example "TEN-301"')

const PLAN = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    parts: { type: 'array', items: { type: 'string' } },
    criteria: { type: 'array', items: { type: 'string' } },
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
  required: ['summary', 'parts', 'criteria', 'questions'],
}

return agent(`Task ${task}. Write the plan: .tenbox/plan.md, the part files and .tenbox/questions.md.`,
  { agentType: 'planner', schema: PLAN, label: 'plan' })
