import { useState } from 'react';
import { submitInspection, type InspectionInput } from '../../../services/returns';
import {
  Button,
  Disclosure,
  Field,
  InlineSpinner,
  SelectInput,
  TextArea,
  TextInput,
} from '../../../components/ui';
import ui from '../../../components/ui.module.css';
import { InspectionSummaryLine } from '../../../components/status';
import { dateTime } from '../../../lib/format';
import type { Runner, WorkspaceData } from './types';

const PHYSICAL = ['EXCELLENT', 'GOOD', 'FAIR', 'DAMAGED']
const PACKAGING = ['SEALED', 'OPENED', 'DAMAGED', 'MISSING']
const FUNCTIONAL = ['PASSED', 'FAILED', 'NOT_TESTED']

export function InspectionSection({ data, run, open }: { data: WorkspaceData; run: Runner; open?: boolean }) {
  const { ret, inspection } = data
  const [form, setForm] = useState<InspectionInput>({
    physicalCondition: 'GOOD',
    packagingCondition: 'OPENED',
    accessoriesComplete: true,
    functionalTestResult: 'NOT_TESTED',
    visibleDamage: '',
    notes: '',
  })
  const [busy, setBusy] = useState(false)
  const canInspect = ['RECEIVED', 'INSPECTION_PENDING', 'INSPECTION_IN_PROGRESS'].includes(ret.status)

  if (inspection) {
    return (
      <Disclosure title="Inspection" sub={`Completed ${dateTime(inspection.inspectedAt)}`} open={open}>
        <p>
          <InspectionSummaryLine
            physical={inspection.physicalCondition}
            packaging={inspection.packagingCondition}
            functional={inspection.functionalTestResult}
          />
        </p>
        <dl style={{ margin: 'var(--sp-3) 0 0' }}>
          <div className={ui.kv}>
            <dt>Accessories</dt>
            <dd>{inspection.accessoriesComplete ? 'Complete' : 'Incomplete'}</dd>
          </div>
          {inspection.visibleDamage && (
            <div className={ui.kv}>
              <dt>Visible damage</dt>
              <dd>{inspection.visibleDamage}</dd>
            </div>
          )}
          {inspection.notes && (
            <div className={ui.kv}>
              <dt>Notes</dt>
              <dd>{inspection.notes}</dd>
            </div>
          )}
        </dl>
      </Disclosure>
    )
  }

  if (!canInspect) return null
  return (
    <Disclosure title="Inspection" sub="Record what is on the bench. Be precise — disposition depends on this." open>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setBusy(true)
          void (async () => {
            try {
              await run(
                () =>
                  submitInspection(ret.id, {
                    ...form,
                    visibleDamage: form.visibleDamage || undefined,
                    notes: form.notes || undefined,
                  }),
                'Inspection recorded.',
              )
            } finally {
              setBusy(false)
            }
          })()
        }}
      >
        <div className={ui.grid2}>
          <Field label="Physical condition" htmlFor="insp-phys">
            <SelectInput
              id="insp-phys"
              value={form.physicalCondition}
              onChange={(e) => setForm({ ...form, physicalCondition: e.target.value })}
            >
              {PHYSICAL.map((v) => (
                <option key={v} value={v}>
                  {v.charAt(0) + v.slice(1).toLowerCase()}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Packaging" htmlFor="insp-pack">
            <SelectInput
              id="insp-pack"
              value={form.packagingCondition}
              onChange={(e) => setForm({ ...form, packagingCondition: e.target.value })}
            >
              {PACKAGING.map((v) => (
                <option key={v} value={v}>
                  {v.charAt(0) + v.slice(1).toLowerCase()}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <div className={ui.grid2}>
          <Field label="Functional test" htmlFor="insp-func">
            <SelectInput
              id="insp-func"
              value={form.functionalTestResult}
              onChange={(e) => setForm({ ...form, functionalTestResult: e.target.value })}
            >
              {FUNCTIONAL.map((v) => (
                <option key={v} value={v}>
                  {v.replace(/_/g, ' ').charAt(0) + v.replace(/_/g, ' ').slice(1).toLowerCase()}
                </option>
              ))}
            </SelectInput>
          </Field>
          <label className={ui.checkRow} style={{ marginTop: '1.4rem' }}>
            <input
              type="checkbox"
              checked={form.accessoriesComplete}
              onChange={(e) => setForm({ ...form, accessoriesComplete: e.target.checked })}
            />
            Accessories complete
          </label>
        </div>
        <Field label="Visible damage (optional)" htmlFor="insp-dmg">
          <TextInput
            id="insp-dmg"
            value={form.visibleDamage}
            onChange={(e) => setForm({ ...form, visibleDamage: e.target.value })}
            placeholder="e.g. cracked rear casing"
          />
        </Field>
        <Field label="Notes (optional)" htmlFor="insp-notes">
          <TextArea
            id="insp-notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Anything the next operator should know"
          />
        </Field>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? <InlineSpinner label="Saving…" /> : 'Complete inspection'}
        </Button>
      </form>
    </Disclosure>
  )
}


