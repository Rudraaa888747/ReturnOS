import { useState } from 'react'
import { downloadReport } from '../../lib/admin'
import { PageHead } from '../../components/ui'
import { friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

const REPORTS = [
  { path: 'orders', label: 'Orders', body: 'Numbers, customers, payment and shipment state.' },
  { path: 'returns', label: 'Returns', body: 'Full return rows with product and resolution.' },
  { path: 'refunds', label: 'Refunds', body: 'Amounts, methods and states with linkage.' },
  { path: 'credit', label: 'Store credit ledger', body: 'Every credit, debit and adjustment.' },
  { path: 'inventory', label: 'Inventory snapshot', body: 'Products with per-site, per-state buckets.' },
  { path: 'movements', label: 'Inventory movements', body: 'Every stock move with reason and reference.' },
] as const

export default function Reports() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function download(path: string): Promise<void> {
    setBusy(path)
    setError(null)
    try {
      const { blob, filename } = await downloadReport(`/reports/${path}.csv?limit=10000`)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Admin"
        title="Reports"
        lede="CSV exports over the same authorized readers as the screens. Up to 10,000 rows each."
      />

      {error && (
        <p className={styles.inlineError} role="alert">
          {error}
        </p>
      )}

      <div className={ops.tableWrap}>
          <table className={ops.table}>
            <thead>
              <tr>
                <th scope="col">Report</th>
                <th scope="col">Contents</th>
                <th scope="col">Download</th>
              </tr>
            </thead>
            <tbody>
              {REPORTS.map((report) => (
                <tr key={report.path}>
                  <td>{report.label}</td>
                  <td className={ops.muted}>{report.body}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      disabled={busy !== null}
                      onClick={() => void download(report.path)}
                    >
                      {busy === report.path ? 'Preparing…' : 'Download CSV'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
    </div>
  )
}
