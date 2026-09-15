import { assessRisk } from '../../../services/returns';
import { Button, Disclosure } from '../../../components/ui';
import { RiskBadge } from '../../../components/status';
import type { Runner, WorkspaceData } from './types';

export function RiskSection({ data, run, open }: { data: WorkspaceData; run: Runner; open?: boolean }) {
  const { ret, inspection, risk } = data
  if (!inspection) return null
  return (
    <Disclosure title="Risk" sub="Operational attention signal — never a fraud accusation." open={open}>
      {!risk ? (
        <Button size="sm" variant="primary" onClick={() => void run(() => assessRisk(ret.id), 'Risk assessed.')}>
          Assess risk
        </Button>
      ) : (
        <>
          <p style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span className="data" style={{ fontSize: 'var(--fs-metric)', fontWeight: 600 }}>
              {risk.score}
            </span>
            <RiskBadge level={risk.level} showHint />
          </p>
          <ul style={{ margin: 'var(--sp-3) 0 0', paddingLeft: 'var(--sp-5)', fontSize: 'var(--fs-body)' }}>
            {risk.factors.map((f) => (
              <li key={f.ruleCode} style={{ marginBottom: 'var(--sp-1)' }}>
                <strong>+{f.points}</strong> · {f.explanation}
              </li>
            ))}
            {risk.factors.length === 0 && <li className="meta">No risk signals fired for this return.</li>}
          </ul>
        </>
      )}
    </Disclosure>
  )
}


