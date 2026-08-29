import { describe, expect, it } from 'vitest'
import {
  GCFORMS_SYNC_BATCH_LIMIT,
  selectGcFormsRemoteSubmissionBatch
} from '../../server/runtime'
import type { GcFormsNewSubmission } from '../../shared/gcforms'

const createRemoteSubmissions = (count: number): GcFormsNewSubmission[] => Array.from(
  { length: count },
  (_, index) => ({
    name: `submission-${String(index).padStart(3, '0')}`,
    createdAt: 1_700_000_000_000 + index
  })
)

describe('GC Forms synchronization bounds', () => {
  it('continues limit plus one in stable remote order without completed-row starvation', () => {
    const remote = createRemoteSubmissions(GCFORMS_SYNC_BATCH_LIMIT + 1).reverse()
    const first = selectGcFormsRemoteSubmissionBatch(remote, [])

    expect(first.selected).toHaveLength(GCFORMS_SYNC_BATCH_LIMIT)
    expect(first.selected.map(submission => submission.name)).toEqual(
      createRemoteSubmissions(GCFORMS_SYNC_BATCH_LIMIT).map(submission => submission.name)
    )
    expect(first.hasMore).toBe(true)

    const second = selectGcFormsRemoteSubmissionBatch(
      remote,
      first.selected.map(submission => ({
        submission_name: submission.name,
        status: 'imported' as const
      }))
    )
    expect(second).toEqual({
      selected: [createRemoteSubmissions(GCFORMS_SYNC_BATCH_LIMIT + 1).at(-1)],
      skippedCount: GCFORMS_SYNC_BATCH_LIMIT,
      hasMore: false
    })
  })

  it('prioritizes never-seen identities while retaining ordered idempotent retries', () => {
    const [retry, unseen] = createRemoteSubmissions(2)
    if (!retry || !unseen) {
      throw new Error('Expected two remote submissions.')
    }

    const first = selectGcFormsRemoteSubmissionBatch([
      retry,
      unseen,
      { ...unseen }
    ], [{ submission_name: retry.name, status: 'problem' }], 1)
    expect(first).toEqual({
      selected: [unseen],
      skippedCount: 1,
      hasMore: true
    })

    const second = selectGcFormsRemoteSubmissionBatch([
      retry,
      unseen
    ], [
      { submission_name: retry.name, status: 'problem' },
      { submission_name: unseen.name, status: 'imported' }
    ], 1)
    expect(second).toEqual({
      selected: [retry],
      skippedCount: 1,
      hasMore: false
    })
  })
})
