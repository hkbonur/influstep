import { PERSONA_COLOR_LABELS, PERSONA_COLORS, type PersonaColor } from '@influstep/shared'
import React from 'react'
import { cn } from '@/lib/cn'
import { createMascotMotion, stillFrame, type AiMascotState, type MascotFrame } from './mascot-motion'

/** Literal class names, so Tailwind sees every persona color utility (a template string would hide them). */
export const PERSONA_TEXT_CLASS: Record<PersonaColor, string> = {
  ink: 'text-persona-ink',
  plum: 'text-persona-plum',
  violet: 'text-persona-violet',
  iris: 'text-persona-iris',
  teal: 'text-persona-teal',
  olive: 'text-persona-olive',
  clay: 'text-persona-clay',
  rose: 'text-persona-rose',
}

/**
 * What a persona's avatar shows: the thinking dots while one of its jobs is
 * queued or running, rest otherwise. A paused persona rests even with jobs in
 * its queue, because the runner leaves them there until the persona resumes.
 */
export function personaAvatarState(persona: { working: boolean; paused: boolean }): AiMascotState {
  if (persona.paused) return 'idle'
  return persona.working ? 'thinking' : 'idle'
}

interface PersonaAvatarProps {
  color: PersonaColor
  state: AiMascotState
  /** Size in px, rendered as a square */
  size?: number
  className?: string
}

/**
 * The persona's mascot as a still picture, for the sidebar, lists and chat. It
 * paints one frame and never starts a loop, so nothing moves on those screens
 * (DESIGN.md, Motion); a working persona shows the three thinking dots, held.
 */
export function PersonaAvatar(props: PersonaAvatarProps) {
  const size = props.size ?? 28
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block shrink-0 select-none', PERSONA_TEXT_CLASS[props.color], props.className)}
      data-state={props.state}
      style={{ width: size, height: size }}
    >
      <svg className="block size-full overflow-visible" viewBox="0 0 100 100">
        <MascotShapes frame={stillFrame(props.state)} />
      </svg>
    </span>
  )
}

/** The living mascot: gaze drift and blinks at rest, the thinking dots while the persona works. Only the persona page mounts it. */
export function PersonaMascot(props: PersonaAvatarProps) {
  const svgRef = React.useRef<SVGSVGElement>(null)
  // React owns the first paint only. Later frames are written straight to the
  // nodes, so a re-render must not hand React different attributes to restore.
  const [firstFrame] = React.useState(() => stillFrame(props.state))
  useMascotMotion(svgRef, props.state)

  const size = props.size ?? 48
  // The wrapper and the svg are written out here and in PersonaAvatar instead of
  // shared: in a component that takes the svg ref as a prop, oxlint's react/refs
  // (React Compiler's ref check) flags every read of its props as a ref read.
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block shrink-0 select-none', PERSONA_TEXT_CLASS[props.color], props.className)}
      data-state={props.state}
      style={{ width: size, height: size }}
    >
      <svg ref={svgRef} className="block size-full overflow-visible" viewBox="0 0 100 100">
        <MascotShapes frame={firstFrame} />
      </svg>
    </span>
  )
}

/**
 * One option per persona color. Native radios, visually hidden but focusable,
 * so arrow keys move the choice and FormData carries `color`. A taken color
 * stays selectable: after eight personas colors repeat.
 */
export function PersonaColorSwatches(props: { value: PersonaColor; onChange: (color: PersonaColor) => void; taken?: PersonaColor[] }) {
  const onChange = props.onChange
  const taken = props.taken ?? []

  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium text-graphite">Color</legend>
      <div className="flex flex-wrap gap-1">
        {PERSONA_COLORS.map((color) => {
          const label = taken.includes(color) ? `${PERSONA_COLOR_LABELS[color]}, in use` : PERSONA_COLOR_LABELS[color]
          return (
            <label
              key={color}
              title={label}
              className={cn(
                'relative grid size-7 cursor-pointer place-items-center rounded-full hover:bg-hairline-strong has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-fog',
                { 'ring-2 ring-ink': props.value === color }
              )}
            >
              <input
                type="radio"
                name="color"
                value={color}
                checked={props.value === color}
                onChange={() => onChange(color)}
                className="sr-only"
              />
              <PersonaAvatar color={color} state="idle" size={24} />
              <span className="sr-only">{label}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** The ball, its dots and its eyes for one frame. The wrapper is a span in both callers, so the picture can sit inside a button or a label. */
function MascotShapes(props: { frame: MascotFrame }) {
  const maskId = React.useId()

  return (
    <>
      <defs>
        {/* The eyes are holes, so an eye sliding past the ball's edge is clipped by it. */}
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="white" />
          {props.frame.eyes.map((eye, index) => (
            <rect
              // Always two eyes, left then right, so the index is a stable key.
              key={index}
              data-mascot-eye=""
              fill="black"
              x={eye.x}
              y={eye.y}
              width={eye.width}
              height={eye.height}
              rx={eye.rx}
              transform={eye.transform}
              opacity={eye.opacity}
            />
          ))}
        </mask>
      </defs>
      {/* Group opacity, so the dots and the ball never darken where they overlap.
          Presentation attributes, not utility classes: a missing class falls back to black paint. */}
      <g fill="currentColor" opacity={0.94} mask={`url(#${maskId})`}>
        <circle data-mascot-body="" cx={props.frame.body.cx} cy="50" r={props.frame.body.r} />
        {props.frame.dots.map((dot, index) => (
          <circle
            // Always two dots, left then right, so the index is a stable key.
            key={index}
            data-mascot-dot=""
            cx={dot.cx}
            cy="50"
            r={dot.r}
            opacity={dot.opacity}
          />
        ))}
      </g>
    </>
  )
}

/** Runs the motion on the mounted SVG while it is on screen, and feeds it each new state. */
function useMascotMotion(svgRef: React.RefObject<SVGSVGElement | null>, state: AiMascotState) {
  const [initialState] = React.useState(state)
  const driverRef = React.useRef<MascotDriver | null>(null)

  React.useEffect(() => {
    const svg = svgRef.current
    if (!svg) throw new Error('PersonaMascot: the SVG is not mounted')
    const driver = startMascotDriver(svg, initialState)
    driverRef.current = driver
    return () => {
      driver.stop()
      driverRef.current = null
    }
  }, [svgRef, initialState])

  React.useEffect(() => {
    driverRef.current?.setState(state)
  }, [state])
}

interface MascotDriver {
  setState: (state: AiMascotState) => void
  stop: () => void
}

interface MascotNodes {
  body: SVGCircleElement
  dots: SVGCircleElement[]
  eyes: SVGRectElement[]
}

function findNodes(svg: SVGSVGElement): MascotNodes {
  const body = svg.querySelector<SVGCircleElement>('[data-mascot-body]')
  const dots = Array.from(svg.querySelectorAll<SVGCircleElement>('[data-mascot-dot]'))
  const eyes = Array.from(svg.querySelectorAll<SVGRectElement>('[data-mascot-eye]'))
  if (!body || dots.length !== 2 || eyes.length !== 2) throw new Error('PersonaMascot: SVG is missing its body, dots or eyes')
  return { body, dots, eyes }
}

function paint(nodes: MascotNodes, frame: MascotFrame) {
  nodes.body.setAttribute('cx', String(frame.body.cx))
  nodes.body.setAttribute('r', String(frame.body.r))
  frame.dots.forEach((dot, index) => {
    const node = nodes.dots[index]
    node.setAttribute('cx', String(dot.cx))
    node.setAttribute('r', String(dot.r))
    node.setAttribute('opacity', String(dot.opacity))
  })
  frame.eyes.forEach((eye, index) => {
    const node = nodes.eyes[index]
    node.setAttribute('x', String(eye.x))
    node.setAttribute('y', String(eye.y))
    node.setAttribute('width', String(eye.width))
    node.setAttribute('height', String(eye.height))
    node.setAttribute('rx', String(eye.rx))
    node.setAttribute('transform', eye.transform)
    node.setAttribute('opacity', String(eye.opacity))
  })
}

/**
 * One animation loop per mascot. It sleeps while the mascot is off screen or
 * hidden, and under reduced motion it paints one still per state instead.
 */
function startMascotDriver(svg: SVGSVGElement, initialState: AiMascotState): MascotDriver {
  const nodes = findNodes(svg)
  // A random head start, so two mascots on one page don't blink in unison.
  const epoch = performance.now() / 1000 - Math.random() * 60
  const now = () => performance.now() / 1000 - epoch
  const motion = createMascotMotion(initialState, now())
  const reducedMotion = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  const canAnimate = typeof window.requestAnimationFrame === 'function'
  let isVisible = true
  let frameId: number | null = null

  const isStill = () => !canAnimate || reducedMotion?.matches === true

  const render = () => {
    paint(nodes, isStill() ? stillFrame(motion.state) : motion.sample(now()))
  }

  const tick = () => {
    frameId = null
    render()
    schedule()
  }

  const schedule = () => {
    if (frameId !== null || !isVisible || isStill()) return
    frameId = window.requestAnimationFrame(tick)
  }

  const cancel = () => {
    if (frameId === null) return
    window.cancelAnimationFrame(frameId)
    frameId = null
  }

  const observer =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(([entry]) => {
          isVisible = entry.isIntersecting
          if (isVisible) schedule()
          else cancel()
        })
      : null
  observer?.observe(svg)

  const handleMotionPreference = () => {
    cancel()
    render()
    schedule()
  }
  reducedMotion?.addEventListener('change', handleMotionPreference)

  schedule()

  return {
    setState(state) {
      motion.setState(state, now())
      if (isStill()) render()
      else schedule()
    },
    stop() {
      cancel()
      observer?.disconnect()
      reducedMotion?.removeEventListener('change', handleMotionPreference)
    },
  }
}
