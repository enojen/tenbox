export const meta = {
  name: 'tenbox-close',
  description: 'Close one Tenbox task after its PR is merged on GitHub',
  whenToUse: 'In the main checkout, after you squash merged the PR. args: the task id.',
  phases: [{ title: 'Close' }],
}

const input = typeof args === 'string' ? { task: args } : (args ?? {})
const task = input.task
if (!task) throw new Error('args: the task id, for example "TEN-301"')

// `tenbox close` refuses before it changes anything; these codes are those refusals.
const REFUSALS = ['unmerged', 'merge-commit', 'in-task-worktree', 'dirty']
const CLOSED = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    code: { type: 'string' },
    error: { type: 'string' },
    pull: { type: 'object' },
    remote_branch: { type: 'object' },
  },
  required: ['ok'],
}

phase('Close')
const closed = await agent(`Run \`tenbox close ${task}\` and return its JSON.`,
  { agentType: 'runner', schema: CLOSED, phase: 'Close', label: 'close' })
if (closed?.ok) return { status: 'closed', closed }
return { status: REFUSALS.includes(closed?.code) ? 'refused' : 'failed', closed }
