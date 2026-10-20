// Pre-buy gate for a Solana trading bot: buy only mints Dexra rates `ok`.
//
//   npm install @dexra-dev/client    # ESM only: "type": "module" in package.json
//   DEXRA_API_KEY=dxr_... npx tsx gate.ts <MINT> [<MINT> ...]
//
// `unknown` usually means the first buyers are still being analyzed, so those
// mints are checked again a few times before the gate gives up on them.

import { Dexra, DexraError } from '@dexra-dev/client'

type Verdict = 'ok' | 'caution' | 'avoid' | 'unknown'
type Launch = { platform: string; verdict: Verdict; reasons: string[] }
type BatchItem = { mint: string; found: boolean; launches: Launch[] }

const RANK: Record<Verdict, number> = { ok: 0, unknown: 1, caution: 2, avoid: 3 }
const RETRIES = 4
const RETRY_DELAY_MS = 5_000

const dexra = new Dexra({ apiKey: process.env.DEXRA_API_KEY })

// A mint can have several pools (pump.fun curve and PumpSwap); the worst verdict decides.
function worst(item: BatchItem): Launch | undefined {
  return item.launches.reduce<Launch | undefined>(
    (acc, launch) => (!acc || RANK[launch.verdict] > RANK[acc.verdict] ? launch : acc),
    undefined,
  )
}

export async function gate(mints: string[]): Promise<Map<string, { buy: boolean; why: string }>> {
  const decisions = new Map<string, { buy: boolean; why: string }>()
  let pending = mints
  for (let attempt = 0; attempt <= RETRIES && pending.length > 0; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    // Up to 5 mints per call on Free, 50 when paid per call.
    const { results } = await dexra.newLaunchesBatch({ mints: pending }) as unknown as { results: BatchItem[] }
    const retry: string[] = []
    for (const item of results) {
      const launch = worst(item)
      if (!item.found || !launch) {
        decisions.set(item.mint, { buy: false, why: 'not a launch Dexra tracks, or created seconds ago' })
        retry.push(item.mint)
      } else if (launch.verdict === 'unknown') {
        decisions.set(item.mint, { buy: false, why: `unknown: ${launch.reasons[0] ?? 'data missing'}` })
        retry.push(item.mint)
      } else {
        decisions.set(item.mint, {
          buy: launch.verdict === 'ok',
          why: `${launch.verdict} on ${launch.platform}${launch.reasons[0] ? `: ${launch.reasons[0]}` : ''}`,
        })
      }
    }
    pending = retry
  }
  return decisions
}

const mints = process.argv.slice(2)
if (mints.length > 0) {
  gate(mints)
    .then((decisions) => {
      for (const [mint, { buy, why }] of decisions) console.log(`${buy ? 'BUY ' : 'SKIP'} ${mint}  ${why}`)
    })
    .catch((error) => {
      if (error instanceof DexraError && error.status === 402) {
        console.error(`Dexra: payment required (${error.subscription ?? 'no key or x402 payment'})`)
      } else {
        console.error(error)
      }
      process.exit(1)
    })
}
