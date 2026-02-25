# Quicknode Troubleshooting Guide

## Authentication Errors (401)

### Symptoms
- `401 Unauthorized` response
- "Invalid token" or "Authentication failed" errors

### Solutions
1. Verify your endpoint URL includes the correct token:
   ```
   https://{name}.solana-mainnet.quiknode.pro/{token}/
   ```
2. Check the endpoint is active in your Quicknode dashboard
3. If using Admin API, verify `x-api-key` header value
4. Check if JWT authentication is enabled — if so, include the JWT token

## Rate Limiting (429)

### Symptoms
- `429 Too Many Requests` response
- Requests being throttled

### Solutions
1. Check your plan's rate limits (requests/sec)
2. Implement exponential backoff:
   ```typescript
   async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 5) {
     for (let i = 0; i < maxRetries; i++) {
       const response = await fetch(url, options);
       if (response.status !== 429) return response;
       const delay = Math.min(1000 * Math.pow(2, i), 30000);
       await new Promise((resolve) => setTimeout(resolve, delay));
     }
     throw new Error("Max retries exceeded");
   }
   ```
3. Batch requests to reduce total call count
4. Cache responses that don't change frequently
5. Upgrade your plan if consistently hitting limits

## DAS API Issues

### "Method not found" Error
- **Cause:** DAS API add-on is not enabled on your endpoint
- **Solution:** Enable the "Metaplex DAS API" add-on in your endpoint's Add-ons tab

### Empty Results from getAssetsByOwner
- **Cause:** Wallet has no indexed assets, or wrong network
- **Solution:**
  1. Verify the wallet address is correct
  2. Confirm you're querying the right network (mainnet vs devnet)
  3. Try with `options: { showFungible: true }` to include tokens

### Pagination Issues
- Use `cursor` from previous response for reliable pagination
- `page`-based pagination may skip items if data changes between requests

## Yellowstone gRPC Issues

### Connection Refused
- **Cause:** Wrong port or endpoint format
- **Solution:** Use port **10000** and derive from your HTTP URL:
  ```
  HTTP:  https://example.solana-mainnet.quiknode.pro/TOKEN/
  gRPC:  https://example.solana-mainnet.quiknode.pro:10000
  ```

### Stream Disconnects
- **Cause:** Network issues or idle timeout
- **Solution:**
  1. Send keepalive pings every **10 seconds**
  2. Implement reconnection with exponential backoff
  3. Enable zstd compression to reduce bandwidth

### No Data Received
- **Cause:** Filters too narrow or wrong commitment level
- **Solution:**
  1. Start with broader filters to verify connectivity
  2. Use `CommitmentLevel.CONFIRMED` (not FINALIZED) for faster data
  3. Verify the program/account IDs in your filter are correct

## Priority Fee API Issues

### "Method not found" for qn_estimatePriorityFees
- **Cause:** Priority Fee API add-on not enabled
- **Solution:** Enable the "Solana Priority Fee API" add-on in your endpoint settings

### Fee Estimates Too High/Low
- Adjust `last_n_blocks` parameter (higher = smoother average, lower = more reactive)
- Use `per_compute_unit.medium` for balanced fee estimation
- Consider using `per_compute_unit.high` during network congestion

## Streams Issues

### Stream Not Receiving Data
1. Verify the stream is in **Active** status in the dashboard
2. Check your filter function returns data (not `null` for all records)
3. Verify the destination URL is accessible
4. Check stream logs in the dashboard for errors

### Filter Function Errors
- Test filter functions locally before deploying
- Use `console.log()` in filter functions for debugging (visible in stream logs)
- Ensure all async operations use `await`
- Check `qnLib` method names are correct (case-sensitive)

## WebSocket Issues

### Connection Drops
```typescript
const ws = new WebSocket(process.env.QUICKNODE_WSS_URL!);

ws.on("close", () => {
  console.log("WebSocket closed — reconnecting...");
  setTimeout(() => {
    // Reconnect logic
  }, 1000);
});

ws.on("error", (error) => {
  console.error("WebSocket error:", error);
});
```

### Subscription Not Working
1. Verify WebSocket URL format: `wss://{name}.solana-mainnet.quiknode.pro/{token}/`
2. Ensure subscription request follows JSON-RPC format
3. Check the account/program address is correct
4. Verify commitment level is valid (`processed`, `confirmed`, `finalized`)

## Network Errors

### ECONNREFUSED / Timeout
1. Check endpoint status at [status.quicknode.com](https://status.quicknode.com)
2. Verify your network connectivity
3. Check if IP allowlisting is blocking your IP
4. Try a different region if available

### SSL/TLS Errors
1. Ensure you're using `https://` (not `http://`)
2. Update your Node.js to a supported version
3. Check system certificates are up to date

## Debug Checklist

1. **Endpoint URL** — Correct format with token included?
2. **Network** — Mainnet vs devnet matches your data?
3. **Add-ons** — Required add-ons (DAS API, Priority Fee, etc.) enabled?
4. **Rate limits** — Within your plan's limits?
5. **Firewall/IP** — IP allowlisting not blocking you?
6. **Dependencies** — SDK and packages up to date?
7. **Environment variables** — Set correctly, no trailing spaces?
