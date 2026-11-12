import { computed, onScopeDispose, readonly, shallowRef } from 'vue'

type GcFormsRequestState<T> =
  | { kind: 'idle' }
  | { kind: 'pending'; request: AbortController }
  | { kind: 'success'; value: T }
  | { kind: 'error'; error: unknown }
  | { kind: 'disposed' }

/** Owns one request lane; data retention and feedback belong to its caller. */
export const useGcFormsRequest = <T = void>() => {
  const state = shallowRef<GcFormsRequestState<T>>({ kind: 'idle' })
  const owns = (request: AbortController): boolean =>
    state.value.kind === 'pending' && state.value.request === request
  const invalidate = () => {
    if (state.value.kind === 'pending') state.value.request.abort()
  }
  const begin = (): AbortController | null => {
    if (state.value.kind === 'disposed') return null
    invalidate()
    const request = new AbortController()
    state.value = { kind: 'pending', request }
    return request
  }
  const succeed = (request: AbortController, value: T): boolean => {
    if (!owns(request)) return false
    state.value = { kind: 'success', value }
    return true
  }
  const fail = (request: AbortController, error: unknown): boolean => {
    if (!owns(request)) return false
    state.value = { kind: 'error', error }
    return true
  }
  const reset = () => {
    if (state.value.kind === 'disposed') return
    invalidate()
    state.value = { kind: 'idle' }
  }
  onScopeDispose(() => {
    invalidate()
    state.value = { kind: 'disposed' }
  })
  return { state: readonly(state), isPending: computed(() => state.value.kind === 'pending'), begin, owns, succeed, fail, reset }
}
