# Agent Create

Create a new Droyd user with an agent, Solana wallet, and API key. The returned API key is automatically saved to `.config`.

## Endpoint

`POST /api/v1/agent/create`

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `email` | string | Yes | Valid email address for the new user |
| `agent_name` | string | No | Display name for the agent |
| `profile_image` | string | No | URL for the agent's profile image |
| `agent_bio` | string | No | Short biography for the agent |

## Examples

```bash
# Create with email only
scripts/droyd-agent-create.sh "user@example.com"

# Create with name and bio
scripts/droyd-agent-create.sh "user@example.com" "My Agent" "" "A helpful trading agent"
```

## Response

```json
{
  "status": "success",
  "data": {
    "user": {
      "user_id": 123,
      "email": "user@example.com",
      "api_key": "drk_..."
    },
    "agent": {
      "agent_id": 456,
      "name": "My Agent",
      "wallet_address": "So1...",
      "chain": "solana",
      "profile_image": "https://example.com/avatar.png"
    },
    "agent_instructions": "..."
  }
}
```

## Notes

- Returns `409 Conflict` if a user with the given email already exists
- The returned API key is automatically written to `.config` in the skill directory
- x402 price: $3.00 flat fee (when no API key is provided)
