import { describe, expect, it } from 'vitest'
import { money } from './format'

describe('money', () => {
  it('formats Indian Rupees with Indian digit grouping', () => {
    expect(money(125000)).toBe('₹1,25,000.00')
    expect(money(4597)).toBe('₹4,597.00')
    expect(money(12999)).toBe('₹12,999.00')
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
