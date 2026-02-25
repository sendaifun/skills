# Quicknode Webhooks Reference

Event-driven notifications for blockchain activity delivered to HTTP endpoints in real-time.

**Docs:** https://www.quicknode.com/docs/webhooks

## Webhooks vs Streams

| Feature | Webhooks | Streams |
|---------|----------|---------|
| **Complexity** | Simple setup | More configuration |
| **Filtering** | Template-based | Custom JavaScript |
| **Destinations** | HTTP only | Webhook, S3, Postgres, Azure, Snowflake |
| **Transformation** | Limited | Full transformation |
| **Best For** | Simple alerts | Complex data pipelines |

Use webhooks for straightforward event notifications. Use Streams for sophisticated filtering, data transformation, or alternative destinations.

## Creating Webhooks

### Dashboard

1. Navigate to **Quicknode Dashboard** → **Webhooks**
2. Click "Create Webhook"
3. Select network (Ethereum, Polygon, Solana, etc.)
4. Choose a webhook template and configure filters
5. Set destination URL
6. Test and activate

### API (Template-Based)

Create webhooks via `POST /webhooks/rest/v1/webhooks/template/{templateId}` with a `templateArgs` object.

## Available Templates

| Template ID | Chain | Description |
|-------------|-------|-------------|
| `evmWalletFilter` | EVM | Monitor transactions to/from specific wallet addresses |
| `evmContractEvents` | EVM | Monitor events emitted by specific contracts |
| `evmAbiFilter` | EVM | Filter by ABI-decoded function calls or events |
| `solanaWalletFilter` | Solana | Monitor transactions involving Solana wallet addresses |
| `bitcoinWalletFilter` | Bitcoin | Monitor transactions involving Bitcoin addresses |

### Solana Wallet Monitoring

```bash
curl -X POST https://api.quicknode.com/webhooks/rest/v1/webhooks/template/solanaWalletFilter \
  -H "Authorization: Bearer $QUICKNODE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Solana Wallet Monitor",
    "network": "solana-mainnet",
    "templateArgs": {
      "addresses": ["E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk"]
    },
    "destination_url": "https://your-server.com/webhook",
    "enabled": true
  }'
```

### EVM Wallet Monitoring

```bash
curl -X POST https://api.quicknode.com/webhooks/rest/v1/webhooks/template/evmWalletFilter \
  -H "Authorization: Bearer $QUICKNODE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Wallet Monitor",
    "network": "ethereum-mainnet",
    "templateArgs": {
      "addresses": ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"]
    },
    "destination_url": "https://your-server.com/webhook",
    "enabled": true
  }'
```

### EVM Contract Events

```bash
curl -X POST https://api.quicknode.com/webhooks/rest/v1/webhooks/template/evmContractEvents \
  -H "Authorization: Bearer $QUICKNODE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "USDC Transfer Events",
    "network": "ethereum-mainnet",
    "templateArgs": {
      "contracts": ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"],
      "events": ["Transfer(address,address,uint256)"]
    },
    "destination_url": "https://your-server.com/webhook",
    "enabled": true
  }'
```

## Payload Formats

### Solana Webhook Payload

```json
{
  "webhookId": "webhook_xyz789",
  "network": "solana-mainnet",
  "timestamp": 1693526400,
  "slot": 200000000,
  "transactions": [
    {
      "signature": "5K8Q...",
      "meta": {
        "fee": 5000,
        "preBalances": [1000000000, 500000000],
        "postBalances": [999995000, 500005000],
        "err": null
      },
      "transaction": {
        "message": {
          "accountKeys": ["Account1...", "Account2..."],
          "instructions": [
            {
              "programIdIndex": 0,
              "accounts": [0, 1],
              "data": "3Bxs..."
            }
          ]
        },
        "signatures": ["5K8Q..."]
      }
    }
  ]
}
```

### EVM Webhook Payload

```json
{
  "webhookId": "webhook_abc123",
  "network": "ethereum-mainnet",
  "timestamp": 1693526400,
  "blockNumber": 18000000,
  "blockHash": "0x...",
  "transactions": [
    {
      "hash": "0x...",
      "from": "0x...",
      "to": "0x...",
      "value": "1000000000000000000",
      "gas": "21000",
      "gasPrice": "50000000000",
      "input": "0x...",
      "nonce": 42,
      "logs": [
        {
          "address": "0x...",
          "topics": ["0xddf252ad...", "0x000...from", "0x000...to"],
          "data": "0x...",
          "logIndex": 0
        }
      ]
    }
  ]
}
```

## Receiving Webhooks

### Express.js with Signature Verification

```javascript
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Verify webhook signature using all three security headers
function verifySignature(payload, signature, nonce, timestamp, secret) {
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(nonce + timestamp + JSON.stringify(payload))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSig)
  );
}

app.post('/webhook', (req, res) => {
  const signature = req.headers['x-qn-signature'];
  const nonce = req.headers['x-qn-nonce'];
  const timestamp = req.headers['x-qn-timestamp'];
  const secret = process.env.WEBHOOK_SECRET;

  if (!verifySignature(req.body, signature, nonce, timestamp, secret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { network, transactions } = req.body;
  for (const tx of transactions) {
    console.log(`New transaction: ${tx.hash || tx.signature}`);
  }

  res.status(200).json({ received: true });
});

app.listen(3000);
```

### Python Flask with Signature Verification

```python
from flask import Flask, request, jsonify
import hmac
import hashlib
import os

app = Flask(__name__)

def verify_signature(payload, signature, nonce, timestamp, secret):
    expected = hmac.new(
        secret.encode(),
        (nonce + timestamp + payload).encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)

@app.route('/webhook', methods=['POST'])
def webhook():
    signature = request.headers.get('X-QN-Signature')
    nonce = request.headers.get('X-QN-Nonce')
    timestamp = request.headers.get('X-QN-Timestamp')
    secret = os.environ.get('WEBHOOK_SECRET')

    if not verify_signature(request.data.decode(), signature, nonce, timestamp, secret):
        return jsonify({'error': 'Invalid signature'}), 401

    data = request.json
    for tx in data.get('transactions', []):
        print(f"New transaction: {tx.get('hash') or tx.get('signature')}")

    return jsonify({'received': True}), 200
```

## Webhook Management API

### List Webhooks

```bash
curl https://api.quicknode.com/webhooks/rest/v1/webhooks \
  -H "Authorization: Bearer $QUICKNODE_API_KEY"
```

### Get Webhook

```bash
curl https://api.quicknode.com/webhooks/rest/v1/webhooks/{webhookId} \
  -H "Authorization: Bearer $QUICKNODE_API_KEY"
```

### Update Webhook

```bash
curl -X PATCH https://api.quicknode.com/webhooks/rest/v1/webhooks/{webhookId} \
  -H "Authorization: Bearer $QUICKNODE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "enabled": false }'
```

### Delete Webhook

```bash
curl -X DELETE https://api.quicknode.com/webhooks/rest/v1/webhooks/{webhookId} \
  -H "Authorization: Bearer $QUICKNODE_API_KEY"
```

### Test Webhook

```bash
curl -X POST https://api.quicknode.com/webhooks/rest/v1/webhooks/{webhookId}/test \
  -H "Authorization: Bearer $QUICKNODE_API_KEY"
```

## Retry Policy

Quicknode automatically retries failed webhook deliveries:

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 1 minute |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5 | 2 hours |

After 5 failed attempts, the webhook is marked as failed.

## Security Best Practices

1. **Verify signatures** — Always validate using all three headers: `X-QN-Signature`, `X-QN-Nonce`, `X-QN-Timestamp`
2. **Use HTTPS** — Never use HTTP endpoints for webhooks
3. **Timeout handling** — Respond within 30 seconds
4. **Idempotency** — Handle duplicate deliveries gracefully
5. **Error handling** — Return proper HTTP status codes
6. **Rate limiting** — Implement rate limiting on your endpoint

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| No deliveries | Template filters too narrow | Broaden filters (add more addresses, broader events) |
| 401 errors | Invalid signature | Check secret configuration |
| Timeouts | Slow processing | Optimize handler; process events async |
| Missing data | Incomplete template config | Add required addresses, events, or parameters |
| Duplicates | Retry deliveries | Implement idempotency |

## Documentation

- **Webhooks Overview**: https://www.quicknode.com/docs/webhooks
- **Webhook Templates API**: https://www.quicknode.com/docs/webhooks/rest-api/webhooks/webhooks-rest-create-from-template
- **API Reference**: https://www.quicknode.com/docs/webhooks/rest-api/getting-started
- **Guides**: https://www.quicknode.com/guides/tags/webhooks
