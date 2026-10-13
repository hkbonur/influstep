import { describe, expect, it } from 'vitest'
import { agentState } from './agents'

describe('agentState', () => {
  it('counts the running jobs, whatever waits behind them', () => {
    const agent = { running: [{}, {}], queued: { next: [{ runsOn: 'runner' as const }] } }
    expect(agentState(agent, false)).toEqual({ kind: 'working', count: 2 })
  })
  it('waits for the runner when a runner job is queued and the runner is offline', () => {
    const agent = { running: [], queued: { next: [{ runsOn: 'backend' as const }, { runsOn: 'runner' as const }] } }
    expect(agentState(agent, false)).toEqual({ kind: 'waiting_for_runner' })
    expect(agentState(agent, true)).toEqual({ kind: 'idle' })
  })
  it('rests when only backend jobs wait, since those never need the runner', () => {
    const agent = { running: [], queued: { next: [{ runsOn: 'backend' as const }] } }
    expect(agentState(agent, false)).toEqual({ kind: 'idle' })
  })
  it('rests with nothing running and nothing queued', () => {
    expect(agentState({ running: [], queued: { next: [] } }, false)).toEqual({ kind: 'idle' })
  })
})
