/* Display formatting + enum labels. Backend enums stay backend truth; these are presentation only. */

import type {
  Disposition,
  ExecutionStatus,
  FunctionalTestResult,
  Order,
  OrderStatus,
  PackagingCondition,
  PhysicalCondition,
  RecoveryStatus,
  ReturnReason,
  ReturnStatus,
  RiskLevel,
  TaskPriority,
  TaskStatus,
  TaskType,
  VendorClaimStatus,
} from './types'

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const num = new Intl.NumberFormat('en-IN')

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return inr.format(value)
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return num.format(value)
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** Customer-facing order title: product name(s), never the raw order number.
 *  Single product → its name ("Earphone"). Multi-product → first name plus
 *  a count ("Earphone + 2 more"). Falls back to the order number only when
 *  the order has no items at all. */
export function orderDisplayName(order: Pick<Order, 'orderNumber' | 'items'>): string {
  const names: string[] = []
  for (const item of order.items ?? []) {
    const name = item.productName?.trim()
    if (name && !names.includes(name)) names.push(name)
  }
  if (names.length === 0) return order.orderNumber
  if (names.length === 1) return names[0]
  return `${names[0]} + ${names.length - 1} more`
}

/** Total units across all line items. */
export function orderUnitCount(order: Pick<Order, 'items'>): number {
  return (order.items ?? []).reduce((n, i) => n + i.quantity, 0)
}

function labelMap<T extends string>(entries: [T, string][]): Record<T, string> {
  return Object.fromEntries(entries) as Record<T, string>
}

export const returnStatusLabel = labelMap<ReturnStatus>([
  ['REQUESTED', 'Requested'],
  ['APPROVED', 'Approved'],
  ['REJECTED', 'Rejected'],
  ['IN_TRANSIT', 'In transit'],
  ['RECEIVED', 'Received'],
  ['INSPECTION_PENDING', 'Inspection queued'],
  ['INSPECTION_IN_PROGRESS', 'Inspecting'],
  ['INSPECTION_COMPLETED', 'Inspection done'],
])

export const orderStatusLabel = labelMap<OrderStatus>([
  ['PLACED', 'Placed'],
  ['DELIVERED', 'Delivered'],
  ['CANCELLED', 'Cancelled'],
])

export const returnReasonLabel = labelMap<ReturnReason>([
  ['DAMAGED', 'Damaged'],
  ['DEFECTIVE', 'Defective'],
  ['WRONG_ITEM', 'Wrong item'],
  ['WRONG_SIZE', 'Wrong size'],
  ['NOT_AS_DESCRIBED', 'Not as described'],
  ['CHANGED_MIND', 'Changed mind'],
  ['MISSING_PARTS', 'Missing parts'],
  ['OTHER', 'Other'],
])

export const dispositionLabel = labelMap<Disposition>([
  ['RESTOCK', 'Restock'],
  ['REFURBISH', 'Refurbish'],
  ['RESELL', 'Resell'],
  ['RETURN_TO_VENDOR', 'Return to vendor'],
  ['LIQUIDATE', 'Liquidate'],
  ['RECYCLE', 'Recycle'],
  ['SCRAP', 'Scrap'],
])

export const executionStatusLabel = labelMap<ExecutionStatus>([
  ['PENDING', 'Pending'],
  ['IN_PROGRESS', 'In progress'],
  ['COMPLETED', 'Completed'],
  ['FAILED', 'Failed'],
])

export const vendorStatusLabel = labelMap<VendorClaimStatus>([
  ['DRAFT', 'Draft'],
  ['SUBMITTED', 'Submitted'],
  ['ACKNOWLEDGED', 'Acknowledged'],
  ['APPROVED', 'Approved'],
  ['REJECTED', 'Rejected'],
  ['SETTLED', 'Settled'],
])

export const recoveryStatusLabel = labelMap<RecoveryStatus>([
  ['PENDING', 'Pending'],
  ['LISTED', 'Listed'],
  ['SOLD', 'Sold'],
  ['SETTLED', 'Settled'],
  ['FAILED', 'Failed'],
])

export const taskTypeLabel = labelMap<TaskType>([
  ['INSPECT_RETURN', 'Inspect return'],
  ['RESTOCK_ITEM', 'Restock item'],
  ['REFURBISH_ITEM', 'Refurbish item'],
  ['SUBMIT_VENDOR_CLAIM', 'Submit vendor claim'],
  ['SEND_TO_LIQUIDATION', 'Send to liquidation'],
  ['PROCESS_RECYCLING', 'Process recycling'],
  ['SCRAP_ITEM', 'Scrap item'],
])

export const taskStatusLabel = labelMap<TaskStatus>([
  ['OPEN', 'Open'],
  ['IN_PROGRESS', 'In progress'],
  ['COMPLETED', 'Completed'],
  ['CANCELLED', 'Cancelled'],
])

export const taskPriorityLabel = labelMap<TaskPriority>([
  ['LOW', 'Low'],
  ['MEDIUM', 'Medium'],
  ['HIGH', 'High'],
])

export const physicalLabel = labelMap<PhysicalCondition>([
  ['EXCELLENT', 'Excellent'],
  ['GOOD', 'Good'],
  ['FAIR', 'Fair'],
  ['DAMAGED', 'Damaged'],
])

export const packagingLabel = labelMap<PackagingCondition>([
  ['SEALED', 'Sealed'],
  ['OPENED', 'Opened'],
  ['DAMAGED', 'Damaged'],
  ['MISSING', 'Missing'],
])

export const functionalLabel = labelMap<FunctionalTestResult>([
  ['PASSED', 'Passed'],
  ['FAILED', 'Failed'],
  ['NOT_TESTED', 'Not tested'],
])

export const riskCopy: Record<RiskLevel, { title: string; hint: string }> = {
  LOW: { title: 'Low', hint: 'Routine return, standard handling' },
  MEDIUM: { title: 'Medium', hint: 'Worth a second look before resale' },
  HIGH: { title: 'High', hint: 'Needs review — recovery at risk' },
}
