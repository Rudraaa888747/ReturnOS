/* Mirrors backend DTOs. Field names match the API exactly. Money arrives as decimal strings/numbers. */

export type Role = 'CUSTOMER' | 'WAREHOUSE_STAFF' | 'ADMIN'
export type OrderStatus = 'PLACED' | 'DELIVERED' | 'CANCELLED'
export type ReturnStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'IN_TRANSIT'
  | 'RECEIVED'
  | 'INSPECTION_PENDING'
  | 'INSPECTION_IN_PROGRESS'
  | 'INSPECTION_COMPLETED'
export type ReturnReason =
  | 'DAMAGED'
  | 'DEFECTIVE'
  | 'WRONG_ITEM'
  | 'WRONG_SIZE'
  | 'NOT_AS_DESCRIBED'
  | 'CHANGED_MIND'
  | 'MISSING_PARTS'
  | 'OTHER'
export type ReceiveMode = 'SHIPPED' | 'COUNTER'
export type PhysicalCondition = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'DAMAGED'
export type PackagingCondition = 'SEALED' | 'OPENED' | 'DAMAGED' | 'MISSING'
export type FunctionalTestResult = 'PASSED' | 'FAILED' | 'NOT_TESTED'
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'
export type Disposition =
  | 'RESTOCK'
  | 'REFURBISH'
  | 'RESELL'
  | 'RETURN_TO_VENDOR'
  | 'LIQUIDATE'
  | 'RECYCLE'
  | 'SCRAP'
export type ExecutionStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
export type VendorClaimStatus = 'DRAFT' | 'SUBMITTED' | 'ACKNOWLEDGED' | 'APPROVED' | 'REJECTED' | 'SETTLED'
export type RecoveryStatus = 'PENDING' | 'LISTED' | 'SOLD' | 'SETTLED' | 'FAILED'
export type TaskType =
  | 'INSPECT_RETURN'
  | 'RESTOCK_ITEM'
  | 'REFURBISH_ITEM'
  | 'SUBMIT_VENDOR_CLAIM'
  | 'SEND_TO_LIQUIDATION'
  | 'PROCESS_RECYCLING'
  | 'SCRAP_ITEM'
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH'

export interface ApiError {
  timestamp: string
  status: number
  code: string
  message: string
  path: string
  errors?: Record<string, string>
}

export interface Page<T> {
  content: T[]
  totalElements: number
  totalPages: number
  number: number
  size: number
}

export interface User {
  id: string
  email: string
  fullName: string
  role: Role
  enabled: boolean
}

export interface AuthResponse {
  token: string
  tokenType: string
  user: User
}

export interface Product {
  id: string
  sku: string
  name: string
  category: string
  description: string | null
  price: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface OrderItem {
  id: string
  productId: string
  productName: string
  sku: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export interface Order {
  id: string
  orderNumber: string
  customerId: string
  status: OrderStatus
  subtotal: number
  deliveredAt: string | null
  createdAt: string
  items: OrderItem[]
}

export interface ReturnItem {
  id: string
  orderItemId: string
  productId: string
  sku: string
  quantity: number
  reason: ReturnReason
  description: string | null
}

export interface ReturnOrder {
  id: string
  returnNumber: string
  orderId: string
  customerId: string
  status: ReturnStatus
  requestedAt: string
  approvedAt: string | null
  rejectedAt: string | null
  rejectionReason: string | null
  receivedAt: string | null
  createdAt: string
  items: ReturnItem[]
}

export interface Inspection {
  id: string
  returnId: string
  physicalCondition: PhysicalCondition
  packagingCondition: PackagingCondition
  accessoriesComplete: boolean
  functionalTestResult: FunctionalTestResult
  visibleDamage: string | null
  notes: string | null
  inspectedBy: string | null
  inspectedAt: string
}

export interface RiskFactor {
  ruleCode: string
  points: number
  explanation: string
}

export interface RiskAssessment {
  id: string
  returnId: string
  score: number
  level: RiskLevel
  factors: RiskFactor[]
  assessedBy: string | null
  assessedAt: string
}

export interface DispositionCandidate {
  disposition: Disposition
  eligible: boolean
  recoveryValue: number
  processingCost: number
  shippingCost: number
  refurbishmentCost: number
  netRecovery: number
  reason: string
}

export interface DispositionEvaluation {
  id: string
  returnId: string
  recommended: Disposition
  candidates: DispositionCandidate[]
  evaluatedBy: string | null
  evaluatedAt: string
  finalDisposition: Disposition | null
  finalizedBy: string | null
  finalizedAt: string | null
  overridden: boolean
  overrideReason: string | null
}

export interface Execution {
  id: string
  returnId: string
  disposition: Disposition
  status: ExecutionStatus
  assigneeId: string | null
  startedAt: string | null
  completedAt: string | null
  durationSeconds: number | null
  failureReason: string | null
  notes: string | null
  createdAt: string
}

export interface RestockRecord {
  id: string
  returnId: string
  executionId: string
  productId: string
  sku: string
  quantity: number
  recoveredQuantity: number
  destination: string
  action: string
  recordedBy: string | null
  recordedAt: string
}

export interface VendorClaim {
  id: string
  returnId: string
  executionId: string
  productId: string
  quantity: number
  reason: ReturnReason
  status: VendorClaimStatus
  vendorReference: string | null
  expectedCredit: number | null
  actualCredit: number | null
  notes: string | null
  createdAt: string
  submittedAt: string | null
  acknowledgedAt: string | null
  decidedAt: string | null
  settledAt: string | null
}

export interface RecoveryRecord {
  id: string
  returnId: string
  executionId: string
  disposition: Disposition
  channel: string
  status: RecoveryStatus
  listedValue: number | null
  expectedRecovery: number
  actualRecovered: number | null
  fees: number
  netRecovered: number
  notes: string | null
  createdAt: string
  listedAt: string | null
  soldAt: string | null
  settledAt: string | null
}

export interface DisposalRecord {
  id: string
  returnId: string
  executionId: string
  disposition: Disposition
  quantity: number
  partner: string | null
  estimatedRecovery: number
  actualRecovery: number | null
  processingCost: number
  completedAt: string
  notes: string | null
  completedBy: string | null
}

export interface OpsTask {
  id: string
  returnId: string
  executionId: string | null
  type: TaskType
  status: TaskStatus
  priority: TaskPriority
  assigneeId: string | null
  createdBy: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  notes: string | null
}

export interface HistoryEvent {
  action: string
  timestamp: string
  actor: string | null
  reason: string | null
}

export interface ReturnHistory {
  returnId: string
  returnNumber: string
  status: ReturnStatus
  requestedAt: string
  createdAt: string
  inspection: {
    physicalCondition: PhysicalCondition
    packagingCondition: PackagingCondition
    functionalTestResult: FunctionalTestResult
    inspectedAt: string
  } | null
  risk: { score: number; level: RiskLevel; assessedAt: string } | null
  disposition: {
    recommended: Disposition
    finalDisposition: Disposition | null
    overridden: boolean
    evaluatedAt: string
    finalizedAt: string | null
  } | null
  execution: {
    status: ExecutionStatus
    startedAt: string | null
    completedAt: string | null
    durationSeconds: number | null
    failureReason: string | null
  } | null
  restock: { quantity: number; recoveredQuantity: number; destination: string } | null
  vendorClaim: { status: VendorClaimStatus; expectedCredit: number | null; actualCredit: number | null } | null
  recovery: {
    status: RecoveryStatus
    expectedRecovery: number
    actualRecovered: number | null
    netRecovered: number
  } | null
  disposal: { disposition: Disposition; quantity: number; actualRecovery: number | null } | null
  tasks: { id: string; type: TaskType; status: TaskStatus }[]
  events: HistoryEvent[]
}

export interface ReturnsAnalytics {
  totalReturns: number
  evaluated: number
  finalized: number
  byFinalDisposition: Record<string, number>
  executionsTotal: number
  executionsCompleted: number
  executionsFailed: number
  executionCompletionRate: number
  avgExecutionSeconds: number
}

export interface RecoveryAnalytics {
  expectedRecovery: number
  actualRecovered: number
  netRecovered: number
  vendorClaimsTotal: number
  vendorClaimsSettled: number
  vendorSettlementRate: number
  vendorExpectedCredit: number
  vendorActualCredit: number
  restockRecords: number
  restockQuantity: number
  recycleCount: number
  scrapCount: number
  liquidationRecords: number
  liquidationActual: number
}

export interface AuditEntry {
  id: string
  action: string
  entityType: string
  entityId: string
  performedBy: string | null
  reason: string | null
  metadata: string | null
  createdAt: string
}
