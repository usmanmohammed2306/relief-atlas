export type ReviewTask = {
  type: string;
  title: string;
  brief: string;
  dueAt: string | null;
  recipientIds: readonly string[];
  location: string;
  instructions: string;
};

export type ReviewField = 'type' | 'title' | 'brief' | 'dueAt' | 'recipientIds' | 'location' | 'instructions';
export type ReviewChange = {
  taskIndex: number;
  field: ReviewField;
  before: string | string[] | null;
  after: string | string[] | null;
};

const fields: ReviewField[] = ['type', 'title', 'brief', 'dueAt', 'recipientIds', 'location', 'instructions'];

// A local comparison, not an approval digest, persisted audit or authorization.
// Tasks are positional in the existing editor; never guess identity across additions/removals.
export function compareReviewTasks(saved: readonly ReviewTask[], proposed: readonly ReviewTask[]) {
  if (saved.length !== proposed.length) return { structureChanged: true, changes: [] as ReviewChange[], changedTasks: 0 };
  const changes: ReviewChange[] = [];
  for (let taskIndex = 0; taskIndex < saved.length; taskIndex++) {
    for (const field of fields) {
      const before = saved[taskIndex][field];
      const after = proposed[taskIndex][field];
      if (field === 'recipientIds') {
        const previous = saved[taskIndex].recipientIds;
        const next = proposed[taskIndex].recipientIds;
        // Order matters: the server assigns waves by position, not set membership.
        if (previous.length !== next.length || previous.some((id, index) => id !== next[index])) {
          changes.push({ taskIndex, field, before: [...previous], after: [...next] });
        }
      } else if (before !== after) {
        changes.push({ taskIndex, field, before: before as string | null, after: after as string | null });
      }
    }
  }
  return { structureChanged: false, changes, changedTasks: new Set(changes.map(change => change.taskIndex)).size };
}
