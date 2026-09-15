import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CandidateList, Donut, Timeline } from './visuals'
import { RiskBadge } from './status'
import type { DispositionCandidate } from '../lib/types'

describe('Timeline', () => {
  it('marks the current step for assistive tech and shows timestamps', () => {
    render(
      <Timeline
        steps={[
          { key: 'a', title: 'Requested', detail: '01 Sep', state: 'done' },
          { key: 'b', title: 'Approved', detail: 'Waiting', state: 'now' },
          { key: 'c', title: 'Received', state: 'todo' },
        ]}
      />,
    )
    expect(screen.getByText('Requested')).toBeInTheDocument()
    expect(screen.getByText('01 Sep')).toBeInTheDocument()
    const current = screen.getByText('Approved').closest('li')
    expect(current?.getAttribute('aria-current')).toBe('step')
    expect(screen.getByRole('list', { name: 'Return journey' })).toBeInTheDocument()
  })
})

describe('Donut', () => {
  it('describes empty data instead of drawing slices', () => {
    render(<Donut label="Disposition mix" slices={[]} />)
    expect(screen.getByRole('img', { name: /no data/i })).toBeInTheDocument()
  })
})

describe('CandidateList', () => {
  const candidates: DispositionCandidate[] = [
    {
      disposition: 'RESTOCK',
      eligible: true,
      recoveryValue: 949.05,
      processingCost: 150,
      shippingCost: 250,
      refurbishmentCost: 0,
      netRecovery: 549.05,
      reason: 'Clean item.',
    },
    {
      disposition: 'SCRAP',
      eligible: false,
      recoveryValue: 0,
      processingCost: 0,
      shippingCost: 0,
      refurbishmentCost: 0,
      netRecovery: 0,
      reason: 'Not irreparable.',
    },
  ]

  it('highlights the pick and keeps ineligible options visible with reasons', () => {
    render(<CandidateList candidates={candidates} picked="RESTOCK" />)
    expect(screen.getByText('Recommended')).toBeInTheDocument()
    expect(screen.getByText(/549 net/)).toBeInTheDocument()
    expect(screen.getByText('Not eligible')).toBeInTheDocument()
    expect(screen.getByText('Not irreparable.')).toBeInTheDocument()
  })
})

describe('RiskBadge', () => {
  it('pairs color with text and hint so meaning never rides on color alone', () => {
    render(<RiskBadge level="HIGH" showHint />)
    expect(screen.getByText('High risk')).toBeInTheDocument()
    expect(screen.getByText(/recovery at risk/i)).toBeInTheDocument()
  })
})
