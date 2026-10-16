import { api } from '@influstep/convex/_generated/api'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { PersonaAvatar, personaAvatarState } from '@/components/persona-avatar'
import { PlatformGlyphs } from '@/components/status'
import { Empty, LinkButton, Mono, PageHeader, Pill, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'

export const Route = createFileRoute('/personas/')({ component: PersonasPage })

function PersonasPage() {
  const personas = useQuery(api.private.personas.list, {})
  return (
    <>
      <PageHeader
        title="Personas"
        lead="Each persona is a profile its five agents work for. Compare them in Reports."
        actions={
          <LinkButton to="/onboarding" search={{ count: 1 }} variant="primary">
            New persona
          </LinkButton>
        }
      />
      {!personas && <Skeleton className="h-40" />}
      {personas && personas.length === 0 && (
        <Empty action={<LinkButton to="/onboarding">Build your roster</LinkButton>}>No personas yet.</Empty>
      )}
      {personas && personas.length > 0 && (
        <div className="divide-y divide-mist border-y border-mist">
          {personas.map((persona) => (
            <div key={persona._id} className="grid items-center gap-x-6 gap-y-2 py-3 sm:grid-cols-[1fr_auto_auto]">
              <div className="flex min-w-0 items-start gap-3">
                <PersonaAvatar
                  color={persona.color}
                  state={personaAvatarState(persona)}
                  size={32}
                  className={cn({ 'text-fog': persona.paused })}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to="/personas/$personaId" params={{ personaId: persona._id }} className="font-medium hover:underline">
                      {persona.name}
                    </Link>
                    {/* The avatar shows the thinking dots but is hidden from screen readers; this says it in words. */}
                    {personaAvatarState(persona) === 'thinking' && <span className="sr-only">working</span>}
                    <Mono className="text-ash">@{persona.handle}</Mono>
                    {persona.paused && <Pill tint="alert-amber">Paused</Pill>}
                    {persona.autoApprove && <Pill tint="fog">Auto-approves</Pill>}
                    {persona.autoPublish && <Pill tint="fog">Publishes on its own</Pill>}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-ash">{persona.niche}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ash">
                    <PlatformGlyphs platforms={persona.formats.map((format) => format.platform)} />
                    <span className="tabular">{persona.episodesPerWeek} a week</span>
                    <span className="tabular">sponsor {Math.round(persona.sponsorDial * 100)}%</span>
                    <span>{persona.pillars.join(' · ')}</span>
                  </div>
                </div>
              </div>
              <dl className="flex gap-5 text-xs">
                <Count label="Published" value={persona.counts.published} />
                {/* Scripts and publish packages to approve, and episodes held by a sign-in (shared waitsOnOperator). */}
                <Count
                  label="Waiting"
                  value={persona.counts.waitsOnOperator}
                  tone={persona.counts.waitsOnOperator > 0 ? 'blue' : undefined}
                />
                <Count label="Failed" value={persona.counts.failed} tone={persona.counts.failed > 0 ? 'red' : undefined} />
                <Count label="Checklist" value={persona.counts.checklist} tone={persona.counts.checklist > 0 ? 'amber' : undefined} />
              </dl>
              <div className="flex gap-2">
                <LinkButton to="/reports/$personaId" params={{ personaId: persona._id }}>
                  Report
                </LinkButton>
                <LinkButton to="/personas/$personaId" params={{ personaId: persona._id }} variant="ghost">
                  Open
                </LinkButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function Count(props: { label: string; value: number; tone?: 'blue' | 'red' | 'amber' }) {
  return (
    <div className="min-w-14">
      <dt className="text-ash">{props.label}</dt>
      <dd
        className={cn('tabular text-base font-medium', {
          'text-note-blue-deep': props.tone === 'blue',
          'text-signal-red-deep': props.tone === 'red',
          'text-alert-amber-deep': props.tone === 'amber',
        })}
      >
        {props.value}
      </dd>
    </div>
  )
}
