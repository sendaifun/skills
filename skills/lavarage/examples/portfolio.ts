/**
 * View portfolio: active positions, PnL, and trade history.
 */
import { LavaApiClient } from '../templates/client'

const client = new LavaApiClient(
  'https://api.lavarage.xyz',
  'lv2_prod_5e5f38fefc893ade780d8a2ccd7433ad8307808c83260e75',
  'your-wallet-pubkey',
)

async function viewPortfolio() {
  // 1. Active positions with computed fields
  const active = await client.getPositions('EXECUTED')

  let totalPnl = 0
  console.log(`Active positions: ${active.length}\n`)
  for (const p of active) {
    const pnl = parseFloat(p.unrealizedPnlUsd || '0')
    totalPnl += pnl
    console.log(
      `${p.side} ${p.baseToken?.symbol}` +
        `  leverage=${p.effectiveLeverage}x` +
        `  entry=$${p.entryPrice}  current=$${p.currentPrice}` +
        `  PnL: $${pnl.toFixed(2)} (${p.roiPercent}%)` +
        `  liq=$${p.liquidationPrice}  LTV=${p.currentLtv}`,
    )
  }
  console.log(`\nTotal unrealized PnL: $${totalPnl.toFixed(2)}`)

  // 2. Closed / liquidated positions
  const closed = await client.getPositions('CLOSED')
  console.log(`\nClosed positions: ${closed.length}`)

  const liquidated = await client.getPositions('LIQUIDATED')
  console.log(`Liquidated positions: ${liquidated.length}`)

  // 3. Recent trade history
  const history = await client.getTradeHistory({ limit: 10 })
  console.log(`\nRecent trades:`)
  for (const event of Array.isArray(history) ? history : history.data || []) {
    console.log(
      `  ${event.eventType} ${event.baseToken?.symbol ?? ''}` +
        `  ${event.createdAt}`,
    )
  }
}

viewPortfolio().catch(console.error)
