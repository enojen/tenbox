export const meta = {
  name: 'tenbox-plan',
  description: 'Plan one Tenbox task: two draft plans, then one plan.md with parts, criteria and questions',
  whenToUse: 'In a task worktree after `tenbox start`. args: the task id, for example "TEN-301".',
  phases: [{ title: 'Draft' }, { title: 'Merge' }],
}

const task = typeof args === 'string' ? args : args?.task
if (!task) throw new Error('args: the task id, for example "TEN-301"')

// Two angles give the merge step real alternatives to choose from.
const ANGLES = ['smallest change first', 'risk first']

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

phase('Draft')
await parallel(ANGLES.map((angle, i) => () =>
  agent(`Task ${task}. Draft a plan, angle: ${angle}. Write it to .tenbox/plan.draft-${i + 1}.md.`,
    { agentType: 'planner', phase: 'Draft', label: angle })))

phase('Merge')
return agent(`Task ${task}. Compare .tenbox/plan.draft-*.md and write the final plan: .tenbox/plan.md, the part files and .tenbox/questions.md.`,
  { agentType: 'planner', schema: PLAN, label: 'merge' })
