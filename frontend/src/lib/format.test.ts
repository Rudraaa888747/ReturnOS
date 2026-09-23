import { describe, expect, it } from 'vitest'
import { money, orderDisplayName, orderUnitCount } from './format'
import type { Order } from './types'

describe('money', () => {
  it('formats Indian Rupees with Indian digit grouping and no decimals', () => {
    expect(money(125000)).toBe('₹1,25,000')
    expect(money(4597)).toBe('₹4,597')
    expect(money(12999)).toBe('₹12,999')
    expect(money(31800.4)).toBe('₹31,800')
  })

  it('never emits foreign currency symbols', () => {
    for (const value of [0, 99.5, 42000, 31800]) {
      const out = money(value)
      expect(out).toMatch(/^₹/)
      expect(out).not.toMatch(/[£$€]/)
    }
  })

  it('renders missing values as an em dash', () => {
    expect(money(null)).toBe('—')
    expect(money(undefined)).toBe('—')
    expect(money(Number.NaN)).toBe('—')
  })
})

function orderLike(items: string[], orderNumber = 'ORD-1'): Pick<Order, 'orderNumber' | 'items'> {
  return {
    orderNumber,
    items: items.map((productName, i) => ({
      id: `oi${i}`,
      productId: `p${i}`,
      productName,
      sku: `SKU-${i}`,
      quantity: 1,
      unitPrice: 100,
      lineTotal: 100,
    })),
  }
}

describe('orderDisplayName', () => {
  it('shows the single product name instead of the order number', () => {
    expect(orderDisplayName(orderLike(['Earphone']))).toBe('Earphone')
  })

  it('summarizes multi-product orders with a "+ N more" suffix', () => {
    expect(orderDisplayName(orderLike(['Earphone', 'Charger', 'Case']))).toBe('Earphone + 2 more')
  })

  it('dedupes repeated product names', () => {
    expect(orderDisplayName(orderLike(['Earphone', 'Earphone']))).toBe('Earphone')
  })

  it('falls back to the order number when there are no items', () => {
    expect(orderDisplayName(orderLike([]))).toBe('ORD-1')
  })
})

describe('orderUnitCount', () => {
  it('sums quantities across line items', () => {
    const order = orderLike(['Earphone', 'Charger'])
    order.items[0].quantity = 2
    order.items[1].quantity = 3
    expect(orderUnitCount(order)).toBe(5)
  })
})
