import { Link, type LinkProps } from '@tanstack/react-router'
import React from 'react'
import type { StatusTint } from '@influstep/shared'
import { cn } from '@/lib/cn'
import { TINT_CLASS } from './status'

/** The small vocabulary every screen shares (DESIGN.md, Components). */

/** One form is idle, saving, or showing why the save failed; never two of those at once. */
export type FormState = { status: 'idle' } | { status: 'saving' } | { status: 'error'; message: string }

type ButtonVariant = 'primary' | 'ghost' | 'destructive' | 'outline'

const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-paper hover:bg-ink-deep disabled:hover:bg-ink',
  outline: 'border border-mist bg-paper text-ink hover:bg-paper-tint',
  ghost: 'text-ink hover:bg-hairline-strong',
  destructive: 'text-signal-red-deep hover:bg-signal-red/10',
}

type ButtonSize = 'sm' | 'md'

/** Shared by Button and LinkButton, so a link that looks like a button is the same size, focus ring and all. */
function buttonClass(variant: ButtonVariant, size: ButtonSize, className: string | undefined): string {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors duration-150 ease-out-quint outline-none focus-visible:ring-2 focus-visible:ring-fog disabled:cursor-not-allowed disabled:opacity-50',
    { 'h-8 px-3 text-sm': size === 'md', 'h-7 px-2.5 text-xs': size === 'sm' },
    BUTTON[variant],
    className
  )
}

/** Takes a `ref` like the element (React 19 passes it as a prop), so a confirm step can hand focus back to the button that opened it. */
export function Button(props: React.ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize; busy?: boolean }) {
  const { variant = 'outline', size = 'md', busy, className, children, ...rest } = props
  return (
    <button type="button" {...rest} disabled={rest.disabled || busy} className={buttonClass(variant, size, className)}>
      {busy && <Spinner />}
      {children}
    </button>
  )
}

export function LinkButton(
  props: LinkProps & { className?: string; variant?: ButtonVariant; size?: ButtonSize; children: React.ReactNode }
) {
  const { className, variant = 'outline', size = 'md', children, ...rest } = props
  return (
    <Link {...rest} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  )
}

/**
 * A page outside the studio, styled as a button. It always opens in a new tab,
 * so the operator keeps the studio where they left it; a router Link would try
 * to route the address inside the app.
 */
export function ExternalLinkButton(props: {
  href: string
  className?: string
  variant?: ButtonVariant
  size?: ButtonSize
  children: React.ReactNode
}) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className={buttonClass(props.variant ?? 'outline', props.size ?? 'md', props.className)}
    >
      {props.children}
    </a>
  )
}

function Spinner() {
  return <span aria-hidden className="size-3 animate-spin rounded-full border-[1.5px] border-current border-r-transparent" />
}

export function Eyebrow(props: { children: React.ReactNode; className?: string }) {
  return <div className={cn('eyebrow', props.className)}>{props.children}</div>
}

export function PageHeader(props: { title: string; lead?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-metric">{props.title}</h1>
        {props.lead && <p className="mt-1 max-w-[65ch] text-ash">{props.lead}</p>}
      </div>
      {props.actions && <div className="flex flex-wrap items-center gap-2">{props.actions}</div>}
    </header>
  )
}

export function Empty(props: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-fog px-4 py-6 text-ash">
      <p className="max-w-[55ch]">{props.children}</p>
      {props.action}
    </div>
  )
}

export function Mono(props: { children: React.ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[0.8125rem] tabular', props.className)}>{props.children}</span>
}

export function Pill(props: { tint: StatusTint; children: React.ReactNode; className?: string; struck?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap',
        TINT_CLASS[props.tint],
        'bg-[color-mix(in_oklch,var(--tint)_18%,transparent)] text-[var(--tint-deep)]',
        { 'line-through': props.struck },
        props.className
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-[var(--tint)]" />
      {props.children}
    </span>
  )
}

/** Takes a `ref` like the element (React 19 passes it as a prop), so the post editor can move focus between parts. */
export function Textarea(props: React.ComponentProps<'textarea'>) {
  const { className, ...rest } = props
  return <textarea {...rest} className={cn('field h-auto min-h-20 resize-y py-2 leading-relaxed', className)} />
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props
  return <input {...rest} className={cn('field', className)} />
}

export function Field(props: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1.5', props.className)}>
      <span className="text-xs font-medium text-graphite">{props.label}</span>
      {props.children}
      {props.hint && <span className="text-xs text-ash">{props.hint}</span>}
    </label>
  )
}

/**
 * A setting that is on or off: the setting's name above, the checkbox with
 * what checking it means, and an optional hint under it that the checkbox is
 * described by. A fieldset, so the name is announced with the checkbox.
 */
export function CheckboxField(props: {
  label: string
  name: string
  defaultChecked: boolean
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  const hintId = React.useId()
  return (
    <fieldset className={cn('flex flex-col gap-1.5', props.className)}>
      <legend className="mb-1.5 text-xs font-medium text-graphite">{props.label}</legend>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name={props.name}
          defaultChecked={props.defaultChecked}
          aria-describedby={props.hint === undefined ? undefined : hintId}
          className="size-3.5 accent-ink"
        />
        {props.children}
      </label>
      {props.hint !== undefined && (
        <span id={hintId} className="text-xs text-ash">
          {props.hint}
        </span>
      )}
    </fieldset>
  )
}

/** A short line that names mock data as mock, on every screen that shows numbers. */
export function MockNote(props: { when: boolean; children?: React.ReactNode }) {
  if (!props.when) return null
  return <p className="text-xs text-ash">{props.children ?? 'Mock providers: these numbers are generated, not measured.'}</p>
}

/** What the report can vouch for and what it cannot (docs/plan.md, v0.2). Shown wherever conversions are counted. */
export function AttributionNote() {
  return (
    <p className="max-w-[65ch] text-xs text-ash">
      Clicks and code redemptions are exact. Demos, signups, trials and link-attributed paid come from PostHog, first touch, and undercount
      visitors who declined cookies. A persona-wide code's redemptions count for the persona, not for an episode.
    </p>
  )
}

export function Skeleton(props: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-hairline-strong', props.className)} />
}

export function ErrorLine(props: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-signal-red/8 px-3 py-2 font-mono text-xs break-words text-signal-red-deep">{props.children}</p>
}
