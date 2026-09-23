import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { api, friendlyMessage, getToken } from '../../lib/api'
import type { DocumentRow, ReturnRow } from '../../lib/api'
import { EmptyState, ErrorState, LoadingState, PageHead } from '../../components/ui'
import styles from './documents.module.css'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

export default function Documents() {
  const [returns, setReturns] = useState<ReturnRow[]>([])
  const [selectedReturnId, setSelectedReturnId] = useState<string>('')
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [loadingReturns, setLoadingReturns] = useState(true)
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [docsError, setDocsError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [docsAttempt, setDocsAttempt] = useState(0)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadReturns(): Promise<void> {
      setLoadingReturns(true)
      setError(null)
      try {
        const data = await api<{ returns: ReturnRow[] }>('/returns')
        if (!cancelled) {
          setReturns(data.returns)
          if (data.returns.length > 0) {
            setSelectedReturnId((prev) => prev || data.returns[0].id)
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(friendlyMessage(err))
        }
      } finally {
        if (!cancelled) {
          setLoadingReturns(false)
        }
      }
    }
    void loadReturns()
    return () => {
      cancelled = true
    }
  }, [attempt])

  useEffect(() => {
    if (!selectedReturnId) {
      setDocuments([])
      return
    }
    let cancelled = false
    async function loadDocs(): Promise<void> {
      setLoadingDocs(true)
      setDocsError(null)
      try {
        const data = await api<{ documents: DocumentRow[] }>(`/documents/return/${selectedReturnId}`)
        if (!cancelled) {
          setDocuments(data.documents)
        }
      } catch (err) {
        if (!cancelled) {
          setDocsError(friendlyMessage(err))
        }
      } finally {
        if (!cancelled) {
          setLoadingDocs(false)
        }
      }
    }
    void loadDocs()
    return () => {
      cancelled = true
    }
  }, [selectedReturnId, docsAttempt])

  async function handleDownload(doc: DocumentRow): Promise<void> {
    setDownloadingId(doc.id)
    setDownloadError(null)
    try {
      // Authenticated download: the plain <a href> carries no Authorization
      // header, so fetch with the bearer token and save the blob instead.
      const token = getToken()
      const response = await fetch(`/api/v1/documents/${doc.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = doc.filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setDownloadError(friendlyMessage(err))
    } finally {
      setDownloadingId(null)
    }
  }

  if (loadingReturns) {
    return (
      <div className={styles.page}>
        <PageHead kicker="Customer" title="Documents" lede="Invoices, labels, and inspection reports for your returns." />
        <LoadingState label="Loading returns" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.page}>
        <PageHead kicker="Customer" title="Documents" lede="Invoices, labels, and inspection reports for your returns." />
        <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} />
      </div>
    )
  }

  if (returns.length === 0) {
    return (
      <div className={styles.page}>
        <PageHead kicker="Customer" title="Documents" lede="Invoices, labels, and inspection reports for your returns." />
        <EmptyState
          title="No returns yet"
          body="Documents are attached to returns. Once you start a return, its files will appear here."
        />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Customer"
        title="Documents"
        lede="Select a return to view and download its documents."
      />

      <section className={styles.panel} aria-label="Select return">
        <div className={styles.selectorRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="return-select">
              Return
            </label>
            <select
              id="return-select"
              className={styles.select}
              value={selectedReturnId}
              onChange={(event) => setSelectedReturnId(event.target.value)}
            >
              {returns.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.return_number} — {item.status}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className={styles.panel} aria-label="Document list" aria-busy={loadingDocs}>
        {loadingDocs ? (
          <LoadingState label="Loading documents" />
        ) : docsError ? (
          <ErrorState message={docsError} onRetry={() => setDocsAttempt((value) => value + 1)} />
        ) : documents.length === 0 ? (
          <EmptyState
            title="No documents"
            body="This return has no documents attached yet. Labels and reports will appear here when they are issued."
          />
        ) : (
          <ul className={styles.list}>
            {documents.map((doc) => (
              <li key={doc.id} className={styles.listItem}>
                <div className={styles.fileMeta}>
                  <span className={styles.kindBadge}>{doc.kind}</span>
                  <div className={styles.fileName}>{doc.filename}</div>
                  <div className={styles.fileSub}>
                    {formatSize(doc.size)} · {formatDate(doc.created_at)}
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.downloadBtn}
                  disabled={downloadingId === doc.id}
                  onClick={() => void handleDownload(doc)}
                  aria-label={`Download ${doc.filename}`}
                >
                  <Download size={15} aria-hidden="true" />
                  {downloadingId === doc.id ? 'Downloading…' : 'Download'}
                </button>
              </li>
            ))}
          </ul>
        )}
        {downloadError && (
          <p className={styles.error} role="alert" style={{ marginTop: 'var(--sp-3)' }}>
            {downloadError}
          </p>
        )}
        <p className={styles.hint} style={{ marginTop: 'var(--sp-3)' }}>
          Downloads are authenticated with your session token.
        </p>
      </section>
    </div>
  )
}
