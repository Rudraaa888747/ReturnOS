import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HomePage from './HomePage'

function renderHome() {
  return render(<HomePage />)
}

describe('HomePage', () => {
  it('opens with the hero and key sections', async () => {
    renderHome()

    expect(
      await screen.findByRole('heading', { name: /Returns shouldn’t be the end of the journey/i }, { timeout: 10000 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Track a return like a shipment manifest.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'One return. One connected journey.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Take control of every return.' })).toBeInTheDocument()
  })

  it('renders the hero operational console for the sample return', async () => {
    renderHome()

    expect(
      await screen.findByRole('region', { name: /RET-2026-0841/ }, { timeout: 10000 }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Next:/)).toBeInTheDocument()
  })

  it('walks the console stages with dots, labels, and step buttons', async () => {
    const user = userEvent.setup()
    renderHome()

    const console_ = await screen.findByRole('region', { name: /RET-2026-0841/ }, { timeout: 10000 })
    // Jump straight to Recovery via its label button; the stamp + counter follow.
    await user.click(within(console_).getByRole('button', { name: 'Recovery' }))
    expect(within(console_).getByText('● Recovery')).toBeInTheDocument()
    expect(within(console_).getByText('6 / 6')).toBeInTheDocument()
    // Step back once with Prev.
    await user.click(within(console_).getByRole('button', { name: 'Previous stage' }))
    expect(within(console_).getByText('● Disposition')).toBeInTheDocument()
  })

  it('minimizes, restores, closes, and reopens the console window', async () => {
    const user = userEvent.setup()
    renderHome()

    const console_ = await screen.findByRole('region', { name: /RET-2026-0841/ }, { timeout: 10000 })
    // Minimize hides the body; the title bar stays.
    await user.click(within(console_).getByRole('button', { name: 'Minimize return window' }))
    expect(screen.queryByText(/Next:/)).not.toBeInTheDocument()
    // Zoom restores it.
    await user.click(screen.getByRole('button', { name: 'Zoom return window' }))
    expect(screen.getByText(/Next:/)).toBeInTheDocument()
    // Close swaps the window for a reopen button.
    await user.click(screen.getByRole('button', { name: 'Close return window' }))
    expect(screen.queryByRole('region', { name: /RET-2026-0841/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reopen RET-2026-0841' }))
    expect(await screen.findByRole('region', { name: /RET-2026-0841/ })).toBeInTheDocument()
  })

  it('describes the product with real lifecycle stages', async () => {
    renderHome()

    const heading = await screen.findByRole('heading', { name: 'One return. One connected journey.' })
    const section = heading.closest('section')!
    for (const stage of [
      'Return initiated',
      'Policy check',
      'Approval',
      'In transit',
      'Received',
      'Inspection',
      'Risk + disposition',
      'Recovery',
    ]) {
      expect(within(section).getByText(stage)).toBeInTheDocument()
    }
  })

  it('tracks a sample return from the tracking section', async () => {
    const user = userEvent.setup()
    renderHome()

    const input = await screen.findByLabelText('Return ID')
    await user.type(input, 'RET-2026-0841')
    await user.click(screen.getByRole('button', { name: 'Track' }))

    expect(await screen.findByText('Ready for refurbishment', {}, { timeout: 5000 })).toBeInTheDocument()
    const ticket = screen.getByLabelText(/Tracking result for RET-2026-0841/)
    expect(within(ticket).getByText('₹7,000 net')).toBeInTheDocument()
  })

  it('rejects malformed return IDs with guidance', async () => {
    const user = userEvent.setup()
    renderHome()

    const input = await screen.findByLabelText('Return ID')
    await user.type(input, 'nope')
    await user.click(screen.getByRole('button', { name: 'Track' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('RET-YYYY-NNNN')
  })
})
