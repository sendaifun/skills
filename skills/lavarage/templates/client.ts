/**
 * Lavarage API Client
 *
 * Copy this file into your project to interact with the Lavarage leveraged trading API.
 * No external dependencies required beyond standard fetch.
 *
 * Usage:
 *   const client = new LavaApiClient('https://api.lavarage.xyz', 'lv2_prod_5e5f38fefc893ade780d8a2ccd7433ad8307808c83260e75', 'wallet-pubkey')
 *   const offers = await client.getOffers({ search: 'BTC', side: 'LONG' })
 */

export interface ApiError {
  statusCode: number
  code: string
  message: string
  detail?: string
}

export class LavaApiClient {
  constructor(
    private apiUrl: string,
    private apiKey: string,
    private wallet: string,
  ) {}

  setWallet(wallet: string) {
    this.wallet = wallet
  }

  getWalletAddress(): string {
    return this.wallet
  }

  // ── Market Discovery ──────────────────────────────────────────────

  /** Search available tokens by name, symbol, or mint address */
  async getTokens(search?: string): Promise<any[]> {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    const qs = params.toString()
    return this.get(`/api/v1/tokens${qs ? `?${qs}` : ''}`)
  }

  /**
   * Search available leveraged trading markets (offers/pools).
   * Each offer is a liquidity pool with a specific token pair, leverage limit, and interest rate.
   *
   * @param opts.search - Search by token name, symbol, or mint address
   * @param opts.side - Filter by 'LONG' or 'SHORT'
   * @param opts.quoteToken - Filter by quote/settlement token address
   * @param opts.tags - Comma-separated tag filter
   * @param opts.limit - Max results (default 50)
   * @param opts.offset - Pagination offset
   */
  async getOffers(opts?: {
    tags?: string
    search?: string
    side?: string
    quoteToken?: string
    limit?: number
    offset?: number
  }): Promise<any[]> {
    const params = new URLSearchParams({ includeTokens: 'true' })
    if (opts?.tags) params.set('tags', opts.tags)
    if (opts?.search) params.set('search', opts.search)
    if (opts?.side) params.set('side', opts.side)
    if (opts?.quoteToken) params.set('quoteToken', opts.quoteToken)
    if (opts?.limit) params.set('limit', String(opts.limit))
    if (opts?.offset != null) params.set('offset', String(opts.offset))
    return this.get(`/api/v1/offers?${params}`)
  }

  // ── Quotes (Preview Trades) ───────────────────────────────────────

  /** Preview opening a position — returns expected output, price impact, fees, liquidation price */
  async getOpenQuote(dto: {
    offerPublicKey: string
    userPublicKey: string
    collateralAmount: string
    leverage: number
    slippageBps?: number
  }): Promise<any> {
    return this.post('/api/v1/positions/quote', dto)
  }

  /** Preview closing a position — returns proceeds, PnL, fees */
  async getCloseQuote(dto: {
    positionAddress: string
    userPublicKey: string
    slippageBps?: number
  }): Promise<any> {
    return this.post('/api/v1/positions/close-quote', dto)
  }

  // ── Positions ─────────────────────────────────────────────────────

  /**
   * List positions for the configured wallet.
   * Returns computed fields: PnL, ROI, liquidation price, LTV, interest, etc.
   *
   * @param status - Filter: 'EXECUTED' (active), 'CLOSED', 'LIQUIDATED', or 'ALL'
   */
  async getPositions(status?: string): Promise<any[]> {
    const params = new URLSearchParams({ owner: this.wallet })
    if (status && status !== 'ALL') params.set('status', status)
    return this.get(`/api/v1/positions?${params}`)
  }

  /** Get a specific position by address */
  async getPosition(address: string): Promise<any> {
    const positions = await this.get(
      `/api/v1/positions?owner=${this.wallet}&limit=250`,
    )
    const match = Array.isArray(positions)
      ? positions.find((p: any) => p.address === address)
      : null
    if (!match) {
      const err: ApiError = {
        statusCode: 404,
        code: 'POSITION_NOT_FOUND',
        message: `Position ${address} not found for wallet ${this.wallet}`,
      }
      throw err
    }
    return match
  }

  /** Get trade event history (open, close, liquidation, split, merge, repay) */
  async getTradeHistory(opts?: {
    positionAddress?: string
    eventType?: string
    limit?: number
    offset?: number
  }): Promise<any> {
    const params = new URLSearchParams({ owner: this.wallet })
    if (opts?.positionAddress)
      params.set('positionAddress', opts.positionAddress)
    if (opts?.eventType) params.set('eventType', opts.eventType)
    if (opts?.limit) params.set('limit', String(opts.limit))
    if (opts?.offset) params.set('offset', String(opts.offset))
    return this.get(`/api/v1/positions/trade-history?${params}`)
  }

  // ── Transaction Builders ──────────────────────────────────────────
  // These return base58-encoded serialized transactions ready to sign.

  /** Build transaction to open a leveraged position */
  async buildOpenTx(dto: {
    offerPublicKey: string
    userPublicKey: string
    collateralAmount: string
    leverage: number
    slippageBps?: number
    astralaneTipLamports?: number
  }): Promise<any> {
    return this.post('/api/v1/positions/open', dto)
  }

  /** Build transaction to close a position */
  async buildCloseTx(dto: {
    positionAddress: string
    userPublicKey: string
    slippageBps?: number
    astralaneTipLamports?: number
  }): Promise<any> {
    return this.post('/api/v1/positions/close', dto)
  }

  /**
   * Build transaction to borrow tokens against collateral (no directional bet).
   * Uses the same /open endpoint — the offer determines borrow behavior.
   * Use getOffers({ side: 'BORROW' }) or pick any offer and use leverage to control LTV.
   * Repay later with buildRepayTx() or buildPartialRepayTx().
   */
  async buildBorrowTx(dto: {
    offerPublicKey: string
    userPublicKey: string
    collateralAmount: string
    leverage: number
    slippageBps?: number
    astralaneTipLamports?: number
  }): Promise<any> {
    return this.post('/api/v1/positions/open', dto)
  }

  /** Build transaction to fully repay a borrow position */
  async buildRepayTx(dto: {
    positionAddress: string
    userPublicKey: string
  }): Promise<any> {
    return this.post('/api/v1/positions/repay', dto)
  }

  /** Build transaction to partially repay a borrow (by basis points) */
  async buildPartialRepayTx(dto: {
    positionAddress: string
    userPublicKey: string
    repaymentBps: number
  }): Promise<any> {
    return this.post('/api/v1/positions/partial-repay', dto)
  }

  /** Build transaction to split a position into two */
  async buildSplitTx(dto: {
    positionAddress: string
    userPublicKey: string
    splitRatioBps: number
  }): Promise<any> {
    return this.post('/api/v1/positions/split', dto)
  }

  /** Build transaction to merge two positions (same token pair & side) */
  async buildMergeTx(dto: {
    firstPositionAddress: string
    secondPositionAddress: string
    userPublicKey: string
  }): Promise<any> {
    return this.post('/api/v1/positions/merge', dto)
  }

  /** Build split+close bundle for partial sell */
  async buildPartialSellTx(dto: {
    positionAddress: string
    userPublicKey: string
    splitRatioBps: number
    slippageBps?: number
  }): Promise<any> {
    return this.post('/api/v1/positions/partial-sell', dto)
  }

  /** Preview impact of increasing borrow / leverage */
  async getIncreaseBorrowQuote(dto: {
    positionAddress: string
    userPublicKey: string
    mode: 'withdraw' | 'compound'
    additionalBorrowAmount?: string
    slippageBps?: number
  }): Promise<any> {
    return this.post('/api/v1/positions/increase-borrow-quote', dto)
  }

  /** Build transaction to increase leverage */
  async buildIncreaseBorrowTx(dto: {
    positionAddress: string
    userPublicKey: string
    additionalBorrowAmount: string
    mode: 'withdraw' | 'compound'
    slippageBps?: number
    astralaneTipLamports?: number
  }): Promise<any> {
    return this.post('/api/v1/positions/increase-borrow', dto)
  }

  /** Preview impact of adding collateral */
  async getAddCollateralQuote(dto: {
    positionAddress: string
    userPublicKey: string
    collateralAmount: string
  }): Promise<any> {
    return this.post('/api/v1/positions/add-collateral-quote', dto)
  }

  /** Build transaction to add collateral (reduce LTV) */
  async buildAddCollateralTx(dto: {
    positionAddress: string
    userPublicKey: string
    collateralAmount: string
    astralaneTipLamports?: number
  }): Promise<any> {
    return this.post('/api/v1/positions/add-collateral', dto)
  }

  // ── Bundle / MEV Protection ───────────────────────────────────────

  /** Submit a single signed transaction with optional MEV protection */
  async submitTransaction(
    transaction: string,
    mevProtect = true,
  ): Promise<any> {
    return this.post('/api/v1/bundle/submit', { transaction, mevProtect })
  }

  /** Submit a Jito bundle (array of signed base58 transactions) */
  async submitBundle(transactions: string[]): Promise<any> {
    return this.post('/api/v1/bundle', { transactions })
  }

  /** Get current Jito tip floor in lamports (for MEV protection fee) */
  async getTipFloor(): Promise<{ tipLamports: number }> {
    return this.get('/api/v1/bundle/tip')
  }

  // ── HTTP internals ────────────────────────────────────────────────

  private async get(path: string): Promise<any> {
    return this.request(path, { method: 'GET' })
  }

  private async post(path: string, body: unknown): Promise<any> {
    return this.request(path, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  private async request(path: string, init: RequestInit): Promise<any> {
    const url = `${this.apiUrl}${path}`
    const res = await fetch(url, {
      ...init,
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    })

    const data = await res.json().catch(() => null)

    if (!res.ok) {
      const err: ApiError = {
        statusCode: res.status,
        code: data?.code ?? 'UNKNOWN_ERROR',
        message: data?.message ?? `API returned ${res.status}`,
        detail: data?.detail,
      }
      throw err
    }

    return data
  }
}
