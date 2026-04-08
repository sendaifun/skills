# Agent Chat

Execute chat interactions with the DROYD agent. Supports multi-turn conversations.

## Endpoint

`POST /api/v1/agent/chat`

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `message` | string | Yes | - | Chat message (max 10,000 chars) |
| `conversation_uuid` | string | No | - | UUID to continue existing conversation |
| `model` | string | No | - | Model to use for generation |
| `attachedContent` | string | No | - | Additional context (max 50,000 chars) |

## Multi-Turn Conversations

The response includes a `conversation_uuid` that can be used to continue the conversation:

**Start conversation:**
```bash
curl -X POST https://api.droyd.ai/api/v1/agent/chat \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "What are the latest trends in DeFi?"}'
```

**Continue conversation:**
```bash
curl -X POST https://api.droyd.ai/api/v1/agent/chat \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Tell me more about the second point",
    "conversation_uuid": "123e4567-e89b-12d3-a456-426614174000"
  }'
```

## Streaming Mode

Add `?stream=true` for real-time responses:

```bash
curl -X POST "https://api.droyd.ai/api/v1/agent/chat?stream=true" \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Analyze the current market conditions"}'
```

## Attached Content

Include additional context with your message:

```bash
curl -X POST https://api.droyd.ai/api/v1/agent/chat \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Summarize this research",
    "attachedContent": "Full text of research document here..."
  }'
```

## Best Practices

1. **Be specific**: "Research the top 5 DeFi protocols on Base by TVL" > "Tell me about DeFi"
2. **Use streaming** for long responses to see progress
3. **Continue conversations** when asking follow-up questions to maintain context
