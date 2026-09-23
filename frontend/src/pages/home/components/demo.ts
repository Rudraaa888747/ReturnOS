/* Sample tracking records for the public homepage demo.
 *
 * There is no public tracking API on the backend (tracking lives behind auth),
 * so the homepage ships clearly-labeled SAMPLE data. To go live, replace
 * `lookupReturn` with a fetch against a future public endpoint using the
 * identical return shape — no component changes required.
 */

export interface DemoStage {
  key: string
  label: string
  detail: string
  state: 'done' | 'now' | 'todo'
}

export interface DemoReturn {
  id: string
  item: string
  sku: string
  warehouse: string
  destination: string
  inspection: string
  disposition: string
  recoveryValue: string
  status: string
  eta: string
  stages: DemoStage[]
}

export const SAMPLE_IDS = ['RET-2026-0841', 'RET-2026-0839', 'RET-2026-0836']

const RECORDS: Record<string, DemoReturn> = {
  'RET-2026-0841': {
    id: 'RET-2026-0841',
    item: '1 × Aurora Headphones · Defective',
    sku: 'SKU-HEADPH-001',
    warehouse: 'Ahmedabad Fulfillment Center · IN-AMD-02',
    destination: 'Refurbishment bench B-14',
    inspection: 'Completed — open box, functional test passed',
    disposition: 'Refurbish',
    recoveryValue: '₹7,000 net',
    status: 'Ready for refurbishment',
    eta: 'Closes in ~2 days',
    stages: [
      { key: 'req', label: 'Initiated', detail: '12 Sep', state: 'done' },
      { key: 'tr', label: 'In transit', detail: 'Carrier scan ×3', state: 'done' },
      { key: 'rc', label: 'Received', detail: '15 Sep · dock 4', state: 'done' },
      { key: 'in', label: 'Inspection', detail: 'Completed', state: 'done' },
      { key: 'dp', label: 'Disposition', detail: 'Refurbish · now', state: 'now' },
      { key: 'rv', label: 'Recovery', detail: 'Bench B-14', state: 'todo' },
    ],
  },
  'RET-2026-0839': {
    id: 'RET-2026-0839',
    item: '1 × Meridian Jacket · Wrong size',
    sku: 'SKU-JKT-918',
    warehouse: 'Ahmedabad Fulfillment Center · IN-AMD-02',
    destination: 'Restock bin A-22',
    inspection: 'Completed — sealed, like new',
    disposition: 'Restock',
    recoveryValue: '₹4,280 net',
    status: 'Ready for restock',
    eta: 'Closes in ~1 day',
    stages: [
      { key: 'req', label: 'Initiated', detail: '11 Sep', state: 'done' },
      { key: 'tr', label: 'In transit', detail: 'Carrier scan ×2', state: 'done' },
      { key: 'rc', label: 'Received', detail: '14 Sep · dock 2', state: 'done' },
      { key: 'in', label: 'Inspection', detail: 'Completed', state: 'done' },
      { key: 'dp', label: 'Disposition', detail: 'Restock · now', state: 'now' },
      { key: 'rv', label: 'Recovery', detail: 'Bin A-22', state: 'todo' },
    ],
  },
  'RET-2026-0836': {
    id: 'RET-2026-0836',
    item: '1 × Trail Runner · Damaged sole',
    sku: 'SKU-SHOE-042',
    warehouse: 'Mumbai Returns Hub · IN-BOM-01',
    destination: 'Vendor claim desk',
    inspection: 'Completed — damaged, beyond repair',
    disposition: 'Return to vendor',
    recoveryValue: '₹2,150 expected credit',
    status: 'Vendor claim drafted',
    eta: 'Closes in ~5 days',
    stages: [
      { key: 'req', label: 'Initiated', detail: '9 Sep', state: 'done' },
      { key: 'tr', label: 'In transit', detail: 'Carrier scan ×4', state: 'done' },
      { key: 'rc', label: 'Received', detail: '13 Sep · dock 1', state: 'done' },
      { key: 'in', label: 'Inspection', detail: 'Completed', state: 'now' },
      { key: 'dp', label: 'Disposition', detail: 'Queued', state: 'todo' },
      { key: 'rv', label: 'Recovery', detail: 'Vendor desk', state: 'todo' },
    ],
  },
}

/** ID format accepted by the demo tracker: RET-YYYY-NNNN. */
export function normalizeId(raw: string): string | null {
  const id = raw.trim().toUpperCase()
  return /^RET-\d{4}-\d{4}$/.test(id) ? id : null
}

/**
 * API-ready lookup. Swap the body for a fetch to a public tracking endpoint;
 * keep the signature (`Promise<DemoReturn | null>`) so callers don't change.
 */
export async function lookupReturn(id: string): Promise<DemoReturn | null> {
  await new Promise((r) => setTimeout(r, 650))
  return RECORDS[id] ?? null
}
