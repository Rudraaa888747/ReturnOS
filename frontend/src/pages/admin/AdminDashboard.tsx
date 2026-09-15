import { useAsync } from '../../hooks/useAsync'
import { count, duration, money } from '../../lib/format'
import { recoveryAnalytics, returnsAnalytics } from '../../services/admin'
import { dispositionLabel } from '../../lib/format'
import type { Disposition } from '../../lib/types'
import { LoadError, Metric, PageHead, Panel, Skeleton } from '../../components/ui'
import ui from '../../components/ui.module.css'
import { Bars, Donut } from '../../components/visuals'

const DISP_COLORS: Record<Disposition, string> = {
  RESTOCK: 'var(--disp-restock)',
  REFURBISH: 'var(--disp-refurbish)',
  RESELL: 'var(--disp-resell)',
  RETURN_TO_VENDOR: 'var(--disp-vendor)',
  LIQUIDATE: 'var(--disp-liquidate)',
  RECYCLE: 'var(--disp-recycle)',
  SCRAP: 'var(--disp-scrap)',
}

export default function AdminDashboard() {
  const returns = useAsync(() => returnsAnalytics())
  const recovery = useAsync(() => recoveryAnalytics())
  const loading = returns.loading || recovery.loading
  const error = returns.error ?? recovery.error

  return (
    <>
      <PageHead
        title="Control center"
        intro="Live operational truth from the analytics APIs — nothing here is sampled or mocked."
      />
      {loading && (
        <>
          <Skeleton height={90} />
          <div style={{ height: 'var(--sp-4)' }} />
          <Skeleton height={220} />
        </>
      )}
      {error && (
        <LoadError
          error={error}
          onRetry={() => {
            returns.reload()
            recovery.reload()
          }}
        />
      )}
      {returns.data && recovery.data && (
        <>
          <p className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>
            Operational health
          </p>
          <div className={ui.grid3} style={{ marginBottom: 'var(--sp-6)' }}>
            <Panel>
              <Metric value={count(returns.data.totalReturns)} label="Total returns" />
              <p className="meta">
                {count(returns.data.finalized)} finalized · {count(returns.data.evaluated)} evaluated
              </p>
            </Panel>
            <Panel>
              <Metric value={`${Math.round(returns.data.executionCompletionRate * 100)}%`} label="Execution completion" />
              <p className="meta">
                {count(returns.data.executionsCompleted)} of {count(returns.data.executionsTotal)} ·{' '}
                {count(returns.data.executionsFailed)} failed
              </p>
            </Panel>
            <Panel>
              <Metric value={duration(returns.data.avgExecutionSeconds)} label="Avg execution time" />
              <p className="meta">From start to finish, completed work only</p>
            </Panel>
          </div>

          <p className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>
            Volume &amp; recovery
          </p>
          <div className={ui.grid2}>
            <Panel title="Disposition mix" sub="Finalized returns by channel.">
              {Object.keys(returns.data.byFinalDisposition).length === 0 ? (
                <p className="meta">Nothing finalized yet — mix appears here first.</p>
              ) : (
                <Donut
                  label="Finalized returns by disposition"
                  slices={Object.entries(returns.data.byFinalDisposition).map(([k, v]) => ({
                    key: k,
                    label: dispositionLabel[k as Disposition] ?? k,
                    value: v,
                    color: DISP_COLORS[k as Disposition] ?? 'var(--ink-faint)',
                  }))}
                />
              )}
            </Panel>
            <Panel title="Expected vs actual recovery" sub="What the engine priced vs what the floor realized.">
              <Bars
                format={money}
                rows={[
                  { key: 'expected', label: 'Expected', value: recovery.data.expectedRecovery, color: 'var(--ink-3)' },
                  { key: 'actual', label: 'Actual', value: recovery.data.actualRecovered, color: 'var(--brand)' },
                  { key: 'net', label: 'Net', value: recovery.data.netRecovered, color: 'var(--disp-restock)' },
                ]}
              />
              <p className="meta" style={{ marginTop: 'var(--sp-3)' }}>
                Recovery gap:{' '}
                <span className="data">
                  {money(recovery.data.expectedRecovery - recovery.data.actualRecovered)}
                </span>
              </p>
            </Panel>
          </div>

          <p className="eyebrow" style={{ marginBottom: 'var(--sp-3)', marginTop: 'var(--sp-6)' }}>
            Channels
          </p>
          <div className={ui.grid2}>
            <Panel title="Vendor claims" sub="Settlement discipline with vendors.">
              <Bars
                format={(v) => count(v)}
                rows={[
                  { key: 'total', label: 'Opened', value: recovery.data.vendorClaimsTotal, color: 'var(--ink-3)' },
                  { key: 'settled', label: 'Settled', value: recovery.data.vendorClaimsSettled, color: 'var(--brand)' },
                ]}
              />
              <p className="meta" style={{ marginTop: 'var(--sp-3)' }}>
                Settlement rate {Math.round(recovery.data.vendorSettlementRate * 100)}% · expected{' '}
                {money(recovery.data.vendorExpectedCredit)} · actual {money(recovery.data.vendorActualCredit)}
              </p>
            </Panel>
            <Panel title="Material outcomes" sub="Units back on shelves or out the door.">
              <Bars
                format={(v) => count(v)}
                rows={[
                  { key: 'restock', label: `Restocked (${recovery.data.restockRecords} records)`, value: recovery.data.restockQuantity, color: 'var(--disp-restock)' },
                  { key: 'recycle', label: 'Recycled', value: recovery.data.recycleCount, color: 'var(--disp-recycle)' },
                  { key: 'scrap', label: 'Scrapped', value: recovery.data.scrapCount, color: 'var(--disp-scrap)' },
                  {
                    key: 'liq',
                    label: `Liquidated (${recovery.data.liquidationRecords} records)`,
                    value: recovery.data.liquidationActual,
                    color: 'var(--disp-liquidate)',
                  },
                ]}
              />
              <p className="meta" style={{ marginTop: 'var(--sp-3)' }}>
                Liquidation values are money; the rest are unit counts.
              </p>
            </Panel>
          </div>
        </>
      )}
    </>
  )
}
