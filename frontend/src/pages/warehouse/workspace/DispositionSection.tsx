import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  evaluateDisposition,
  finalizeDisposition,
  overrideDisposition,
} from '../../../services/returns';
import { dispositionLabel } from '../../../lib/format';
import {
  Badge,
  Button,
  Disclosure,
  Field,
  InlineSpinner,
  SelectInput,
  TextInput,
} from '../../../components/ui';
import ui from '../../../components/ui.module.css';
import { CandidateList } from '../../../components/visuals';
import { DispositionMark } from '../../../components/status';
import type { Disposition } from '../../../lib/types';
import type { Runner, WorkspaceData } from './types';

export function DispositionSection({
  data,
  run,
  isAdmin,
  open,
}: {
  data: WorkspaceData
  run: Runner
  isAdmin: boolean
  open?: boolean
}) {
  const { ret, inspection, disposition } = data
  const [choice, setChoice] = useState<Disposition | ''>('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  if (!inspection) return null

  const finalize = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await run(
        () =>
          finalizeDisposition(
            ret.id,
            choice === '' ? undefined : choice,
            reason.trim() === '' ? undefined : reason.trim(),
          ),
        'Final disposition recorded.',
      )
      setChoice('')
      setReason('')
    } finally {
      setBusy(false)
    }
  }

  const doOverride = async () => {
    if (choice === '' || reason.trim().length < 3) return
    setBusy(true)
    try {
      await run(() => overrideDisposition(ret.id, choice as Disposition, reason.trim()), 'Recommendation overridden.')
      setChoice('')
      setReason('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Disclosure title="Disposition" sub="The engine recommends; a human decides." open={open}>
      {!disposition ? (
        <Button
          size="sm"
          variant="primary"
          onClick={() => void run(() => evaluateDisposition(ret.id), 'Disposition evaluated.')}
        >
          Evaluate disposition
        </Button>
      ) : (
        <>
          <p style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="eyebrow">Recommended</span>
            <DispositionMark value={disposition.recommended} />
            {disposition.finalDisposition && (
              <>
                <span className="meta">→ final:</span>
                <DispositionMark value={disposition.finalDisposition} />
                {disposition.overridden && <Badge tone="warn">Overridden</Badge>}
              </>
            )}
          </p>
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <CandidateList candidates={disposition.candidates} picked={disposition.recommended} />
          </div>
          {!disposition.finalDisposition && (
            <form onSubmit={finalize} style={{ marginTop: 'var(--sp-4)' }}>
              <div className={ui.grid2}>
                <Field
                  label="Final channel"
                  htmlFor="disp-choice"
                  hint={isAdmin ? undefined : 'Only admins can override the recommendation.'}
                >
                  <SelectInput
                    id="disp-choice"
                    value={choice === '' ? disposition.recommended : choice}
                    onChange={(e) => setChoice(e.target.value as Disposition)}
                  >
                    {disposition.candidates
                      .filter((c) => c.eligible)
                      .map((c) => (
                        <option
                          key={c.disposition}
                          value={c.disposition}
                          disabled={!isAdmin && c.disposition !== disposition.recommended}
                        >
                          {dispositionLabel[c.disposition]}
                          {c.disposition === disposition.recommended ? ' (recommended)' : ''}
                        </option>
                      ))}
                  </SelectInput>
                </Field>
                <Field
                  label="Override reason"
                  htmlFor="disp-reason"
                  hint="Required when the final channel differs from the recommendation."
                >
                  <TextInput
                    id="disp-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. refurb partner unavailable for this category"
                  />
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                <Button variant="primary" type="submit" disabled={busy}>
                  {busy ? <InlineSpinner label="Recording…" /> : 'Record final disposition'}
                </Button>
                {isAdmin && (
                  <Button
                    type="button"
                    disabled={busy || choice === '' || choice === disposition.recommended || reason.trim().length < 3}
                    onClick={() => void doOverride()}
                  >
                    Override as admin
                  </Button>
                )}
              </div>
            </form>
          )}
          {disposition.finalDisposition && disposition.overridden && disposition.overrideReason && (
            <p className="meta" style={{ marginTop: 'var(--sp-3)' }}>
              Override reason: {disposition.overrideReason}
            </p>
          )}
        </>
      )}
    </Disclosure>
  )
}


