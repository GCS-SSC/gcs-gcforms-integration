import { describe, expect, it } from 'vitest'
import { effectScope } from 'vue'
import { useGcFormsRequest } from '../../components/useGcFormsRequest'

describe('GC Forms request ownership', () => {
  it('rejects superseded settlement and owns success and failure payloads', () => {
    const scope = effectScope()
    const lane = scope.run(() => useGcFormsRequest<string>())!
    const first = lane.begin()!
    const second = lane.begin()!
    expect(first.signal.aborted).toBe(true)
    expect(lane.succeed(first, 'stale')).toBe(false)
    expect(lane.isPending.value).toBe(true)
    expect(lane.fail(first, new Error('stale'))).toBe(false)
    expect(lane.succeed(second, 'current')).toBe(true)
    expect(lane.state.value).toEqual({ kind: 'success', value: 'current' })
    const retry = lane.begin()!
    const error = new Error('unavailable')
    expect(lane.fail(retry, error)).toBe(true)
    expect(lane.state.value).toEqual({ kind: 'error', error })
    scope.stop()
  })
  it('invalidates reset and permanently rejects work after scope disposal', () => {
    const scope = effectScope()
    const lane = scope.run(() => useGcFormsRequest())!
    const first = lane.begin()!
    lane.reset()
    expect(first.signal.aborted).toBe(true)
    expect(lane.succeed(first, undefined)).toBe(false)
    expect(lane.state.value.kind).toBe('idle')
    const second = lane.begin()!
    scope.stop()
    expect(second.signal.aborted).toBe(true)
    expect(lane.fail(second, new Error('late'))).toBe(false)
    lane.reset()
    expect(lane.state.value.kind).toBe('disposed')
    expect(lane.begin()).toBeNull()
  })
})
