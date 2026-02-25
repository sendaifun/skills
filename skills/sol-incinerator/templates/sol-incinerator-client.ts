type JsonObject = Record<string, unknown>;

export type SolIncineratorClientConfig = {
  baseUrl: string;
  apiKey: string;
};

export type RelaySendResponse = {
  signature: string;
  sent: boolean;
  confirmation?: {
    slot?: number;
    err?: unknown;
    confirmations?: number | null;
    confirmationStatus?: string | null;
    commitment?: string;
  };
};

export class SolIncineratorClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: SolIncineratorClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
  }

  static async createPublicApiKey(baseUrl: string, label?: string): Promise<string> {
    const url = `${baseUrl.replace(/\/+$/, '')}/api-keys/generate`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API key generation failed (${response.status}): ${body}`);
    }

    const data = await response.json() as { apiKey?: string };
    if (!data.apiKey) {
      throw new Error('API key generation returned no apiKey');
    }

    return data.apiKey;
  }

  async burnPreview(input: {
    userPublicKey: string;
    assetId: string;
    burnAmount?: string;
    feePayer?: string;
    referralCode?: string;
    partnerFeeAccount?: string;
    partnerFeeBps?: number;
  }): Promise<JsonObject> {
    return this.request('POST', '/burn/preview', input);
  }

  async burn(input: {
    userPublicKey: string;
    assetId: string;
    burnAmount?: string;
    autoCloseTokenAccounts?: boolean;
    asLegacyTransaction?: boolean;
    feePayer?: string;
    priorityFeeMicroLamports?: number;
    referralCode?: string;
    partnerFeeAccount?: string;
    partnerFeeBps?: number;
  }): Promise<JsonObject> {
    return this.request('POST', '/burn', input);
  }

  async closePreview(input: {
    userPublicKey: string;
    assetId: string;
    feePayer?: string;
    referralCode?: string;
    partnerFeeAccount?: string;
    partnerFeeBps?: number;
  }): Promise<JsonObject> {
    return this.request('POST', '/close/preview', input);
  }

  async close(input: {
    userPublicKey: string;
    assetId: string;
    asLegacyTransaction?: boolean;
    feePayer?: string;
    priorityFeeMicroLamports?: number;
    referralCode?: string;
    partnerFeeAccount?: string;
    partnerFeeBps?: number;
  }): Promise<JsonObject> {
    return this.request('POST', '/close', input);
  }

  async batchCloseAllPreview(input: {
    userPublicKey: string;
    offset?: number;
    limit?: number;
    referralCode?: string;
    partnerFeeAccount?: string;
    partnerFeeBps?: number;
  }): Promise<JsonObject> {
    return this.request('POST', '/batch/close-all/preview', input);
  }

  async batchCloseAll(input: {
    userPublicKey: string;
    asLegacyTransaction?: boolean;
    feePayer?: string;
    priorityFeeMicroLamports?: number;
    offset?: number;
    limit?: number;
    referralCode?: string;
    partnerFeeAccount?: string;
    partnerFeeBps?: number;
  }): Promise<JsonObject> {
    return this.request('POST', '/batch/close-all', input);
  }

  async sendSignedTransaction(input: {
    signedTransaction: string;
    encoding?: 'base58' | 'base64';
    skipPreflight?: boolean;
    maxRetries?: number;
    minContextSlot?: number;
    preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
    waitForConfirmation?: boolean;
    confirmationCommitment?: 'processed' | 'confirmed' | 'finalized';
    confirmationTimeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<RelaySendResponse> {
    return this.request('POST', '/transactions/send', input) as Promise<RelaySendResponse>;
  }

  async sendSignedTransactionBatch(input: {
    signedTransactions: string[];
    encoding?: 'base58' | 'base64';
    maxConcurrency?: number;
    skipPreflight?: boolean;
    maxRetries?: number;
    minContextSlot?: number;
    preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
    waitForConfirmation?: boolean;
    confirmationCommitment?: 'processed' | 'confirmed' | 'finalized';
    confirmationTimeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<JsonObject> {
    return this.request('POST', '/transactions/send-batch', input);
  }

  async getTransactionStatus(signature: string, searchTransactionHistory = true): Promise<JsonObject> {
    return this.request('POST', '/transactions/status', {
      signature,
      searchTransactionHistory,
    });
  }

  private async request(method: 'GET' | 'POST', path: string, body?: JsonObject): Promise<JsonObject> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    const maybeJson = text.length ? tryParseJson(text) : {};

    if (!response.ok) {
      const message = typeof maybeJson?.error === 'string'
        ? maybeJson.error
        : text || `HTTP ${response.status}`;
      throw new Error(`Sol-Incinerator request failed: ${message}`);
    }

    return maybeJson;
  }
}

function tryParseJson(value: string): JsonObject {
  try {
    return JSON.parse(value) as JsonObject;
  } catch {
    return { raw: value };
  }
}
