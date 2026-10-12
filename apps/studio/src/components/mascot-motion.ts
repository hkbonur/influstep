// The motion model follows jeremy-prt/bloub (MIT), which measured the x.ai bot
// frame by frame: the ball holds still, the eyes are capsules painted on a
// sphere, changes are exponential ease-outs with no overshoot, and the life at
// rest is gaze drift plus blinking. The glances to other sides are authored. `thinking` is bloub's measured three-dot
// morph.
//
// Everything below is a pure function of time, so the motion is testable
// without a DOM and pausing the loop costs nothing.
//
// Ported from Formstep's packages/ui (components/misc/ai-mascot-motion.ts),
// without Formstep's `typing` state: a persona only rests or works.

export type AiMascotState = 'idle' | 'thinking'

/** Head orientation in degrees. Positive yaw looks right, positive pitch looks up, roll tilts the head. */
interface Gaze {
  yaw: number
  pitch: number
  roll: number
}

interface Dot {
  /** Centre offset from the ball's centre, in ball radii */
  x: number
  /** Radius, in ball radii */
  r: number
  opacity: number
}

interface Pose {
  /** The ball itself; in `thinking` it shrinks into the middle dot */
  body: { x: number; r: number }
  /** Left and right dots. Hidden inside the ball unless `thinking` pushes them out */
  dots: [Dot, Dot]
  gaze: Gaze
  /** Half the angle between the eyes on the sphere, in degrees */
  split: number
  /** Capsule size, in ball radii: `w` across, `h` along */
  eye: { w: number; h: number }
  eyeOpacity: number
  /** How much of the idle gaze drift plays on top of the pose */
  wander: number
  /** How much of the idle glances play on top of the pose */
  glance: number
}

interface StateDef {
  /** Seconds the entry blend takes */
  morph: number
  /** The bot hides a change of face behind a blink */
  blinkIn: boolean
  pose: (t: number) => Pose
}

interface DotFrame {
  cx: number
  r: number
  opacity: number
}

interface EyeFrame {
  x: number
  y: number
  width: number
  height: number
  rx: number
  transform: string
  opacity: number
}

export interface MascotFrame {
  body: { cx: number; r: number }
  dots: [DotFrame, DotFrame]
  eyes: [EyeFrame, EyeFrame]
}

/** The SVG is drawn in a 100-unit box; the ball sits in the middle. */
const CENTER = 50
const BALL_RADIUS = 42

/**
 * Where the eyes rest: up and to the side, which is what gives the ball its
 * volume. bloub measured the x.ai bot at yaw 28.5, pitch 28.6, roll -13, up and
 * to the right; this is a softer version of that look, mirrored to the left.
 */
const REST_GAZE: Gaze = { yaw: -16, pitch: 14, roll: 8 }
const REST_SPLIT = 15.5
const REST_EYE = { w: 0.22, h: 0.46 }

/** Measured thinking dots: positions, radius, and how much each one swells at its peak. */
const DOT_X = [-0.557, -0.013, 0.532] as const
const DOT_R = 0.165
const DOT_PEAK = 1.25

/**
 * Where a glance can turn the head. Home is the rest gaze; up-right mirrors it,
 * so the bot switches sides instead of only nudging around one spot.
 */
const HOME_LOOK = 0
const LOOKS: { gaze: Gaze; weight: number }[] = [
  { gaze: REST_GAZE, weight: 0.35 },
  { gaze: { yaw: 16, pitch: 12, roll: -8 }, weight: 0.2 },
  { gaze: { yaw: -22, pitch: 0, roll: 5 }, weight: 0.09 },
  { gaze: { yaw: 24, pitch: 0, roll: -6 }, weight: 0.09 },
  { gaze: { yaw: -12, pitch: -10, roll: 4 }, weight: 0.09 },
  { gaze: { yaw: 10, pitch: -10, roll: -4 }, weight: 0.09 },
  { gaze: { yaw: 0, pitch: 6, roll: 0 }, weight: 0.09 },
]
const GLANCE_SECONDS = 0.35

const BLINK_SECONDS = 0.18
const FORCED_BLINK_SECONDS = 0.2
const CLOSED_LID = 0.06

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const lerp = (from: number, to: number, t: number) => from + (to - from) * t
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
const easeOutQuint = (t: number) => 1 - (1 - t) ** 5
const toRadians = (degrees: number) => (degrees * Math.PI) / 180
const round = (value: number) => Math.round(value * 100) / 100

/** Seamless periodic noise; mutually prime periods keep the drift from visibly repeating. */
function loopNoise(t: number, period: number, seed: number) {
  const phase = (t / period) * Math.PI * 2
  return 0.55 * Math.sin(phase + seed) + 0.3 * Math.sin(2 * phase + seed * 1.7 + 1.1) + 0.15 * Math.sin(3 * phase + seed * 2.3 + 2.4)
}

/** The wave that runs through the three thinking dots, left to right. */
function dotPulse(t: number, index: number) {
  const phase = ((((t - index * 0.5) / 1.5) % 1) + 1) % 1
  if (phase >= 0.5) return 0
  return clamp(2 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2)))
}

/** Side dots tucked inside the ball, so they can grow out of it. */
const HIDDEN_DOTS: [Dot, Dot] = [
  { x: DOT_X[0] * 0.3, r: DOT_R, opacity: 0 },
  { x: DOT_X[2] * 0.3, r: DOT_R, opacity: 0 },
]

const REST_POSE: Pose = {
  body: { x: 0, r: 1 },
  dots: HIDDEN_DOTS,
  gaze: REST_GAZE,
  split: REST_SPLIT,
  eye: REST_EYE,
  eyeOpacity: 1,
  wander: 1,
  glance: 1,
}

function thinkingPose(t: number): Pose {
  // The side dots stay fused with the ball for a moment before they detach.
  const emerge = 0.3 + 0.7 * easeOutCubic(clamp(t / 0.3))
  const sideDot = (index: 0 | 2): Dot => {
    const pulse = dotPulse(t, index)
    return { x: DOT_X[index] * emerge, r: DOT_R * (1 + (DOT_PEAK - 1) * pulse), opacity: 0.55 + 0.45 * pulse }
  }
  return {
    ...REST_POSE,
    // The ball becomes the middle dot, so the morph stays one continuous shape.
    body: { x: DOT_X[1], r: DOT_R * (1 + (DOT_PEAK - 1) * dotPulse(t, 1)) },
    dots: [sideDot(0), sideDot(2)],
    eyeOpacity: 0,
    wander: 0,
    glance: 0,
  }
}

const STATES: Record<AiMascotState, StateDef> = {
  idle: { morph: 0.45, blinkIn: false, pose: () => REST_POSE },
  thinking: { morph: 0.4, blinkIn: true, pose: thinkingPose },
}

const blendGaze = (from: Gaze, to: Gaze, t: number): Gaze => ({
  yaw: lerp(from.yaw, to.yaw, t),
  pitch: lerp(from.pitch, to.pitch, t),
  roll: lerp(from.roll, to.roll, t),
})

const blendDot = (from: Dot, to: Dot, t: number): Dot => ({
  x: lerp(from.x, to.x, t),
  r: lerp(from.r, to.r, t),
  opacity: lerp(from.opacity, to.opacity, t),
})

function blendPose(from: Pose, to: Pose, t: number): Pose {
  return {
    body: { x: lerp(from.body.x, to.body.x, t), r: lerp(from.body.r, to.body.r, t) },
    dots: [blendDot(from.dots[0], to.dots[0], t), blendDot(from.dots[1], to.dots[1], t)],
    gaze: blendGaze(from.gaze, to.gaze, t),
    split: lerp(from.split, to.split, t),
    eye: { w: lerp(from.eye.w, to.eye.w, t), h: lerp(from.eye.h, to.eye.h, t) },
    eyeOpacity: lerp(from.eyeOpacity, to.eyeOpacity, t),
    wander: lerp(from.wander, to.wander, t),
    glance: lerp(from.glance, to.glance, t),
  }
}

/** mulberry32: the same seed gives the same timetable on every load. */
function seededRandom(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** A blink timetable drawn once from a seeded generator: 1.9 to 4.6 s apart, sometimes doubled. */
const BLINK_PERIOD = 600
const BLINKS = (() => {
  const random = seededRandom(0x5eed)
  const starts: number[] = []
  for (let t = 1.4; t < BLINK_PERIOD - 5; t += 1.9 + random() * 2.7) {
    starts.push(t)
    if (random() < 0.18) {
      t += 0.24
      starts.push(t)
    }
  }
  return starts
})()

/** 1 when the eyes are open, 0 when shut. Closes fast, reopens a little slower. */
function scheduledLid(t: number) {
  const local = ((t % BLINK_PERIOD) + BLINK_PERIOD) % BLINK_PERIOD
  for (const start of BLINKS) {
    if (local < start) return 1
    const k = (local - start) / BLINK_SECONDS
    if (k <= 1) return k < 0.45 ? 1 - k / 0.45 : (k - 0.45) / 0.55
  }
  return 1
}

/** Picks a look other than `current`, by weight. */
function pickLook(current: number, roll: number) {
  const total = LOOKS.reduce((sum, look, index) => (index === current ? sum : sum + look.weight), 0)
  let left = roll * total
  for (let index = 0; index < LOOKS.length; index++) {
    if (index === current) continue
    left -= LOOKS[index].weight
    if (left < 0) return index
  }
  return current === HOME_LOOK ? 1 : HOME_LOOK
}

/**
 * A glance timetable drawn once from a seeded generator. Home holds 2.5 to 6 s,
 * any other look 1 to 3.2 s, and a glance away often comes straight back home.
 */
const GLANCE_PERIOD = 600
const GLANCES = (() => {
  const random = seededRandom(0x91a2)
  const glances: { start: number; gaze: Gaze }[] = []
  let look = HOME_LOOK
  for (let t = 0; t < GLANCE_PERIOD - 8;) {
    glances.push({ start: t, gaze: LOOKS[look].gaze })
    t += look === HOME_LOOK ? 2.5 + random() * 3.5 : 1 + random() * 2.2
    look = look !== HOME_LOOK && random() < 0.55 ? HOME_LOOK : pickLook(look, random())
  }
  return glances
})()

/** The head turn at `t`, as an offset from the rest gaze. Wraps around the period without a jump. */
function glanceAt(t: number): Gaze {
  const local = ((t % GLANCE_PERIOD) + GLANCE_PERIOD) % GLANCE_PERIOD
  let index = 0
  while (index + 1 < GLANCES.length && GLANCES[index + 1].start <= local) index++
  const previous = GLANCES[(index - 1 + GLANCES.length) % GLANCES.length].gaze
  const { start, gaze } = GLANCES[index]
  const look = blendGaze(previous, gaze, easeOutQuint(clamp((local - start) / GLANCE_SECONDS)))
  return { yaw: look.yaw - REST_GAZE.yaw, pitch: look.pitch - REST_GAZE.pitch, roll: look.roll - REST_GAZE.roll }
}

type Vec3 = [number, number, number]

/** Turns two orthonormal vectors by `angle` within their shared plane. */
function turn(u: Vec3, v: Vec3, angle: number): [Vec3, Vec3] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [
    [u[0] * cos + v[0] * sin, u[1] * cos + v[1] * sin, u[2] * cos + v[2] * sin],
    [v[0] * cos - u[0] * sin, v[1] * cos - u[1] * sin, v[2] * cos - u[2] * sin],
  ]
}

interface ProjectedEye {
  /** Centre on screen, in ball radii from the ball's centre */
  x: number
  y: number
  /** The sphere's tangent frame at the eye, projected: an SVG `matrix(a b c d)` */
  a: number
  b: number
  c: number
  d: number
  /** How much the eye faces the viewer; at 0 it reaches the ball's edge */
  depth: number
}

/**
 * Paints both eyes onto a unit sphere turned by `gaze` and projects them flat.
 * The eye nearer the edge comes out narrower and tilted, which is what makes a
 * flat circle read as a ball.
 */
function projectEyes(gaze: Gaze, split: number): [ProjectedEye, ProjectedEye] {
  let forward: Vec3 = [0, 0, 1]
  let right: Vec3 = [1, 0, 0]
  let down: Vec3 = [0, 1, 0]
  ;[forward, right] = turn(forward, right, toRadians(gaze.yaw))
  ;[down, forward] = turn(down, forward, toRadians(gaze.pitch))
  ;[right, down] = turn(right, down, toRadians(gaze.roll))

  const eye = (side: -1 | 1): ProjectedEye => {
    const [normal, tangent] = turn(forward, right, toRadians(split * side))
    return { x: normal[0], y: normal[1], a: tangent[0], b: tangent[1], c: down[0], d: down[1], depth: normal[2] }
  }
  return [eye(-1), eye(1)]
}

function drawEye(eye: ProjectedEye, pose: Pose, lid: number): EyeFrame {
  const scale = BALL_RADIUS * pose.body.r
  const width = Math.max(pose.eye.w * scale, 0.01)
  const height = Math.max(pose.eye.h * scale, 0.01)
  // A blink squashes the eye vertically on screen, not along the capsule's own axis.
  const squash = CLOSED_LID + (1 - CLOSED_LID) * clamp(lid)
  const x = CENTER + (pose.body.x + eye.x * pose.body.r) * BALL_RADIUS
  const y = CENTER + eye.y * pose.body.r * BALL_RADIUS
  return {
    x: round(-width / 2),
    y: round(-height / 2),
    width: round(width),
    height: round(height),
    rx: round(Math.min(width, height) / 2),
    transform: `matrix(${round(eye.a)} ${round(eye.b * squash)} ${round(eye.c)} ${round(eye.d * squash)} ${round(x)} ${round(y)})`,
    opacity: round(pose.eyeOpacity * clamp(eye.depth / 0.12)),
  }
}

function drawDot(dot: Dot): DotFrame {
  return { cx: round(CENTER + dot.x * BALL_RADIUS), r: round(dot.r * BALL_RADIUS), opacity: round(dot.opacity) }
}

function draw(pose: Pose, lid: number, drift: Gaze, glance: Gaze): MascotFrame {
  const gaze = {
    yaw: pose.gaze.yaw + drift.yaw * pose.wander + glance.yaw * pose.glance,
    pitch: pose.gaze.pitch + drift.pitch * pose.wander + glance.pitch * pose.glance,
    roll: pose.gaze.roll + drift.roll * pose.wander + glance.roll * pose.glance,
  }
  const [left, right] = projectEyes(gaze, pose.split)
  return {
    body: { cx: round(CENTER + pose.body.x * BALL_RADIUS), r: round(pose.body.r * BALL_RADIUS) },
    dots: [drawDot(pose.dots[0]), drawDot(pose.dots[1])],
    eyes: [drawEye(left, pose, lid), drawEye(right, pose, lid)],
  }
}

const STILL: Gaze = { yaw: 0, pitch: 0, roll: 0 }

/** Seconds into each state that read best as a still: the first paint, and the whole show under reduced motion. */
const STILL_AT: Record<AiMascotState, number> = { idle: 0, thinking: 1.1 }

export function stillFrame(state: AiMascotState): MascotFrame {
  return draw(STATES[state].pose(STILL_AT[state]), 1, STILL, STILL)
}

export interface MascotMotion {
  readonly state: AiMascotState
  setState: (state: AiMascotState, now: number) => void
  /** The frame at `now`, in seconds. Reading it changes nothing. */
  sample: (now: number) => MascotFrame
}

export function createMascotMotion(initial: AiMascotState, now: number): MascotMotion {
  let state = initial
  // Pick up where `stillFrame` left the first paint, so mounting doesn't jump.
  let enteredAt = now - STILL_AT[initial]
  // The still has no drift or glances; easing them in from it keeps the mount smooth.
  let from: Pose | null = { ...STATES[initial].pose(STILL_AT[initial]), wander: 0, glance: 0 }
  let blinkAt = Number.NEGATIVE_INFINITY

  const poseAt = (t: number) => {
    const def = STATES[state]
    const pose = def.pose(t - enteredAt)
    const progress = (t - enteredAt) / def.morph
    if (!from || progress >= 1) return pose
    return blendPose(from, pose, easeOutQuint(clamp(progress)))
  }

  return {
    get state() {
      return state
    },
    setState(next, t) {
      if (next === state) return
      // Blending from the frame on screen keeps a change landing mid-blend continuous.
      from = poseAt(t)
      state = next
      enteredAt = t
      if (STATES[next].blinkIn) blinkAt = t
    },
    sample(t) {
      const pose = poseAt(t)
      const forced = clamp((t - blinkAt) / FORCED_BLINK_SECONDS)
      const lid = Math.min(scheduledLid(t), forced < 1 ? Math.abs(forced * 2 - 1) : 1)
      const drift = {
        yaw: loopNoise(t, 11.3, 0.4) * 5.5 + loopNoise(t, 3.7, 2.1) * 1.6,
        pitch: loopNoise(t, 9.1, 1.3) * 4.2 + loopNoise(t, 4.3, 0.7) * 1.3,
        roll: loopNoise(t, 13.7, 3.2) * 2.2,
      }
      return draw(pose, lid, drift, glanceAt(t))
    },
  }
}
