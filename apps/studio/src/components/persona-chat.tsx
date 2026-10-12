import { api } from '@influstep/convex/_generated/api'
import type { Doc } from '@influstep/convex/_generated/dataModel'
import { readsAsDirective } from '@influstep/shared'
import { useMutation } from 'convex/react'
import React from 'react'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { Button, ErrorLine, Eyebrow } from './ui'

/**
 * The persona's chat (DESIGN.md, Chat): operator right on paper-warm, persona
 * left with a hairline. Active directives sit pinned above the composer.
 */
export function PersonaChat(props: { persona: Doc<'personas'>; messages: Doc<'messages'>[]; directives: Doc<'directives'>[] }) {
  const send = useMutation(api.private.personas.sendMessage)
  const withdraw = useMutation(api.private.personas.withdrawDirective)
  const [text, setText] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const endRef = React.useRef<HTMLDivElement>(null)
  const count = props.messages.length
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [count])

  const submit = async () => {
    const value = text.trim()
    if (!value) return
    setBusy(true)
    setError(null)
    try {
      await send({ personaId: props.persona._id, text: value })
      setText('')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const willBeDirective = readsAsDirective(text)

  return (
    <section className="flex min-h-0 flex-col" aria-label="Chat">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {props.messages.length === 0 && (
          <p className="text-ash">
            Say what you want from {props.persona.name}. A line that starts with focus, stop, always, never, more, less, or try becomes a
            directive every agent reads.
          </p>
        )}
        {props.messages.map((message) => (
          <div key={message._id} className={cn('flex flex-col gap-0.5', { 'items-end': message.author === 'operator' })}>
            <div
              className={cn('max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap', {
                'bg-paper-warm': message.author === 'operator',
                'border border-mist bg-paper': message.author === 'persona',
              })}
            >
              {message.text}
            </div>
            <span className="tabular px-1 font-mono text-[11px] text-ash">
              {message.author === 'operator' ? 'You' : `@${props.persona.handle}`} · {formatDateTime(message.createdAt)}
              {message.directiveId && ' · directive'}
            </span>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {props.directives.length > 0 && (
        <div className="mt-3 border-t border-mist pt-3">
          <Eyebrow className="mb-1.5">Directives in force</Eyebrow>
          <ul className="space-y-1">
            {props.directives.map((directive) => (
              <li key={directive._id} className="flex items-start gap-2 text-sm">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-ink" />
                <span className="flex-1">{directive.text}</span>
                <button type="button" onClick={() => withdraw({ directiveId: directive._id })} className="text-xs text-ash hover:text-ink">
                  Withdraw
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form
        className="mt-3 flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void submit()
            }
          }}
          rows={2}
          placeholder={`Message ${props.persona.name}`}
          className="field h-auto resize-none py-2 leading-relaxed"
          aria-label="Message"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ash">
            {willBeDirective ? 'Reads as a directive: it stays in force until you withdraw it.' : 'Cmd+Enter to send'}
          </span>
          <Button type="submit" variant="primary" size="sm" busy={busy} disabled={!text.trim()}>
            Send
          </Button>
        </div>
        {error && <ErrorLine>{error}</ErrorLine>}
      </form>
    </section>
  )
}
