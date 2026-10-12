import { describe, expect, it } from 'vitest'
import { createMascotMotion, stillFrame, type AiMascotState, type MascotFrame } from './mascot-motion'

const STATES: AiMascotState[] = ['idle', 'thinking']

/** Every number a frame carries, eye transforms included, in a fixed order. */
function numbers(frame: MascotFrame): number[] {
  return [
    frame.body.cx,
    frame.body.r,
    ...frame.dots.flatMap((dot) => [dot.cx, dot.r, dot.opacity]),
    ...frame.eyes.flatMap((eye) => [
      eye.x,
      eye.y,
      eye.width,
      eye.height,
      eye.rx,
      eye.opacity,
      ...eye.transform.slice('matrix('.length, -1).split(' ').map(Number),
    ]),
  ]
}

/** Largest change of any value between two consecutive frames. */
function largestStep(frames: MascotFrame[]): number {
  let largest = 0
  for (let index = 1; index < frames.length; index++) {
    const before = numbers(frames[index - 1])
    const after = numbers(frames[index])
    for (let value = 0; value < before.length; value++) {
      largest = Math.max(largest, Math.abs(after[value] - before[value]))
    }
  }
  return largest
}

/** Samples at 60 fps from `from` to `to` seconds, switching state at the given times. */
function run(from: number, to: number, switches: [number, AiMascotState][]): MascotFrame[] {
  const motion = createMascotMotion('idle', from)
  const pending = [...switches]
  const frames: MascotFrame[] = []
  for (let t = from; t <= to; t += 1 / 60) {
    while (pending.length && pending[0][0] <= t) motion.setState(pending.shift()![1], t)
    frames.push(motion.sample(t))
  }
  return frames
}

describe('mascot motion', () => {
  it('draws a finite still for every state', () => {
    for (const state of STATES) {
      expect(numbers(stillFrame(state)).every(Number.isFinite)).toBe(true)
    }
  })

  it('shows the face at rest and folds it away while thinking', () => {
    expect(stillFrame('idle').eyes.every((eye) => eye.opacity > 0.9)).toBe(true)
    expect(stillFrame('thinking').eyes.every((eye) => eye.opacity === 0)).toBe(true)
  })

  it('shrinks the ball into the middle dot and pushes the side dots out while thinking', () => {
    const idle = stillFrame('idle')
    const thinking = stillFrame('thinking')
    expect(thinking.body.r).toBeLessThan(idle.body.r / 3)
    expect(thinking.dots[0].cx).toBeLessThan(thinking.body.cx - thinking.body.r)
    expect(thinking.dots[1].cx).toBeGreaterThan(thinking.body.cx + thinking.body.r)
    expect(idle.dots.every((dot) => dot.opacity === 0)).toBe(true)
  })

  it('keeps the ball still at rest; only the eyes move', () => {
    const frames = run(10, 20, [])
    expect(new Set(frames.map((frame) => `${frame.body.cx} ${frame.body.r}`)).size).toBe(1)
    expect(new Set(frames.map((frame) => frame.eyes[0].transform)).size).toBeGreaterThan(100)
  })

  it('glances to both sides at rest, not only to its home side', () => {
    // The eyes' midpoint on screen, from each eye's matrix translation.
    const centres = run(0, 120, []).map((frame) => {
      const [left, right] = frame.eyes.map((eye) => Number(eye.transform.split(' ')[4]))
      return (left + right) / 2
    })
    expect(Math.min(...centres)).toBeLessThan(44)
    expect(Math.max(...centres)).toBeGreaterThan(56)
  })

  it('blinks on its own at rest', () => {
    const lids = run(0, 10, []).map((frame) => Number(frame.eyes[0].transform.split(' ')[3]))
    const open = Math.max(...lids)
    expect(Math.min(...lids)).toBeLessThan(open * 0.5)
  })

  it('morphs between states without jumping, even when a change lands mid-blend', () => {
    const spaced = run(0, 6, [
      [1, 'thinking'],
      [2.5, 'idle'],
      [4, 'thinking'],
    ])
    const rushed = run(0, 3, [
      [1, 'thinking'],
      [1.1, 'idle'],
      [1.15, 'thinking'],
      [1.3, 'idle'],
    ])
    // The ease-out is fast in its first frame by design, so the bar is a normal
    // change, not zero. A jump would be a whole pose apart: the ball alone
    // shrinks by 35 units when it folds into a dot.
    expect(largestStep(spaced)).toBeLessThan(8)
    expect(largestStep(rushed)).toBeLessThanOrEqual(largestStep(spaced))
  })

  it('reads the same frame twice when nothing changed in between', () => {
    const motion = createMascotMotion('thinking', 0)
    expect(motion.sample(3.3)).toEqual(motion.sample(3.3))
  })
})
