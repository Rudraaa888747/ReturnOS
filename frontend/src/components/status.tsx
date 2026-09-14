import { AlertTriangle, CheckCircle2, Info, MinusCircle } from 'lucide-react'
import {
  dispositionLabel,
  executionStatusLabel,
  functionalLabel,
  orderStatusLabel,
  packagingLabel,
  physicalLabel,
  recoveryStatusLabel,
  returnStatusLabel,
  riskCopy,
  taskPriorityLabel,
  taskStatusLabel,
  taskTypeLabel,
  vendorStatusLabel,
} from '../lib/format'
import type {
  Disposition,
  ExecutionStatus,
  FunctionalTestResult,
  OrderStatus,
  PackagingCondition,
  PhysicalCondition,
  RecoveryStatus,
  ReturnStatus,
  RiskLevel,
  TaskPriority,
  TaskStatus,
  TaskType,
  VendorClaimStatus,
} from '../lib/types'
import { Badge } from './ui'

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'neutral'

function toneForReturn(status: ReturnStatus): Tone {
  switch (status) {
    case 'APPROVED':
    case 'RECEIVED':
    case 'INSPECTION_COMPLETED':
      return 'ok'
    case 'REJECTED':
      return 'bad'
    case 'REQUESTED':
    case 'IN_TRANSIT':
    case 'INSPECTION_PENDING':
    case 'INSPECTION_IN_PROGRESS':
      return 'info'
  }
}

function toneForExecution(status: ExecutionStatus): Tone {
  switch (status) {
    case 'COMPLETED':
      return 'ok'
    case 'FAILED':
      return 'bad'
    case 'IN_PROGRESS':
      return 'info'
    case 'PENDING':
      return 'neutral'
  }
}

function toneForTask(status: TaskStatus): Tone {
  switch (status) {
    case 'COMPLETED':
      return 'ok'
    case 'CANCELLED':
      return 'neutral'
    case 'IN_PROGRESS':
      return 'info'
    case 'OPEN':
      return 'warn'
  }
}

export function ReturnBadge({ status }: { status: ReturnStatus }) {
  return <Badge tone={toneForReturn(status)}>{returnStatusLabel[status]}</Badge>
}

export function OrderBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={status === 'DELIVERED' ? 'ok' : status === 'CANCELLED' ? 'neutral' : 'info'}>{orderStatusLabel[status]}</Badge>
}

export function ExecutionBadge({ status }: { status: ExecutionStatus }) {
  return <Badge tone={toneForExecution(status)}>{executionStatusLabel[status]}</Badge>
}

export function VendorBadge({ status }: { status: VendorClaimStatus }) {
  const tone: Tone =
    status === 'SETTLED' || status === 'APPROVED'
      ? 'ok'
      : status === 'REJECTED'
        ? 'bad'
        : status === 'DRAFT'
          ? 'neutral'
          : 'info'
  return <Badge tone={tone}>{vendorStatusLabel[status]}</Badge>
}

export function RecoveryBadge({ status }: { status: RecoveryStatus }) {
  const tone: Tone =
    status === 'SETTLED' || status === 'SOLD'
      ? 'ok'
      : status === 'FAILED'
        ? 'bad'
        : status === 'PENDING'
          ? 'neutral'
          : 'info'
  return <Badge tone={tone}>{recoveryStatusLabel[status]}</Badge>
}

export function TaskBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={toneForTask(status)}>{taskStatusLabel[status]}</Badge>
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const tone: Tone = priority === 'HIGH' ? 'bad' : priority === 'MEDIUM' ? 'warn' : 'neutral'
  return <Badge tone={tone}>{taskPriorityLabel[priority]} priority</Badge>
}

const riskIcons = {
  LOW: <CheckCircle2 size={13} aria-hidden="true" />,
  MEDIUM: <Info size={13} aria-hidden="true" />,
  HIGH: <AlertTriangle size={13} aria-hidden="true" />,
}

/** Risk is never color alone: label + icon + supporting hint. */
export function RiskBadge({ level, showHint }: { level: RiskLevel; showHint?: boolean }) {
  const tone: Tone = level === 'LOW' ? 'ok' : level === 'MEDIUM' ? 'warn' : 'bad'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
      <Badge tone={tone}>
        {riskIcons[level]}
        {riskCopy[level].title} risk
      </Badge>
      {showHint && <span className="meta">{riskCopy[level].hint}</span>}
    </span>
  )
}

const dispVar: Record<Disposition, string> = {
  RESTOCK: 'var(--disp-restock)',
  REFURBISH: 'var(--disp-refurbish)',
  RESELL: 'var(--disp-resell)',
  RETURN_TO_VENDOR: 'var(--disp-vendor)',
  LIQUIDATE: 'var(--disp-liquidate)',
  RECYCLE: 'var(--disp-recycle)',
  SCRAP: 'var(--disp-scrap)',
}

export function DispositionMark({ value }: { value: Disposition }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
      <span
        aria-hidden="true"
        style={{ width: 8, height: 8, borderRadius: '50%', background: dispVar[value], flex: 'none' }}
      />
      {dispositionLabel[value]}
    </span>
  )
}

export function InspectionSummaryLine({
  physical,
  packaging,
  functional,
}: {
  physical: PhysicalCondition
  packaging: PackagingCondition
  functional: FunctionalTestResult
}) {
  return (
    <span>
      {physicalLabel[physical]} · {packagingLabel[packaging]} · Functional: {functionalLabel[functional].toLowerCase()}
    </span>
  )
}

export function TaskTypeLabel({ type }: { type: TaskType }) {
  return <>{taskTypeLabel[type]}</>
}

export function EmptyIcon() {
  return <MinusCircle size={13} aria-hidden="true" />
}
