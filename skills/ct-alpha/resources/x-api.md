# X API v2 Reference (for ct-alpha)

## Authentication

All requests require `Authorization: Bearer <X_BEARER_TOKEN>` header.

## Search Recent Tweets

```
GET https://api.x.com/2/tweets/search/recent
```

Returns tweets from the last 7 days.

### Parameters

| Param | Required | Description |
|-------|----------|-------------|
| `query` | Yes | Search query (max 1024 chars), supports operators below |
| `max_results` | No | 10-100 (default 10) |
| `sort_order` | No | `recency` or `relevancy` |
| `start_time` | No | ISO 8601 timestamp |
| `end_time` | No | ISO 8601 timestamp |
| `next_token` | No | Pagination token |
| `tweet.fields` | No | `created_at,public_metrics,author_id,conversation_id,entities` |
| `user.fields` | No | `username,name,verified,public_metrics,created_at` |
| `expansions` | No | `author_id` |

### Search Operators

| Operator | Example | Description |
|----------|---------|-------------|
| keyword | `solana alpha` | Matches tweets containing both words |
| `"exact"` | `"yield strategy"` | Exact phrase match |
| `OR` | `$SOL OR solana` | Either term |
| `-` | `-airdrop` | Exclude term |
| `from:` | `from:username` | Tweets by specific user |
| `to:` | `to:username` | Replies to user |
| `is:retweet` | `-is:retweet` | Filter retweets |
| `is:reply` | `-is:reply` | Filter replies |
| `has:links` | `has:links` | Tweets with URLs |
| `has:media` | `has:media` | Tweets with images/video |
| `url:` | `url:github.com` | Tweets linking to domain |
| `lang:` | `lang:en` | Language filter |
| `conversation_id:` | `conversation_id:123` | All tweets in a conversation |
| `$` | `$SOL` | Cashtag (for tickers) |
| `#` | `#Solana` | Hashtag |

### Response Format

```json
{
  "data": [
    {
      "id": "123",
      "text": "tweet content",
      "author_id": "456",
      "created_at": "2024-01-01T00:00:00.000Z",
      "conversation_id": "123",
      "public_metrics": {
        "like_count": 10,
        "retweet_count": 5,
        "reply_count": 2,
        "quote_count": 1,
        "impression_count": 1000,
        "bookmark_count": 3
      },
      "entities": {
        "urls": [{"expanded_url": "https://..."}],
        "mentions": [{"username": "user"}],
        "hashtags": [{"tag": "Solana"}]
      }
    }
  ],
  "includes": {
    "users": [
      {
        "id": "456",
        "username": "user",
        "name": "Display Name",
        "verified": true,
        "created_at": "2020-01-01T00:00:00.000Z",
        "public_metrics": {
          "followers_count": 10000,
          "following_count": 500,
          "tweet_count": 5000
        }
      }
    ]
  },
  "meta": {
    "result_count": 10,
    "next_token": "abc123"
  }
}
```

## User Lookup

```
GET https://api.x.com/2/users/by/username/:username
```

## User Tweets

```
GET https://api.x.com/2/users/:id/tweets
```

## Single Tweet

```
GET https://api.x.com/2/tweets/:id
```

## Rate Limits

- Search: 450 requests / 15 min (app), 300 / 15 min (user)
- User lookup: 300 / 15 min
- User tweets: 1500 / 15 min
- On 429: Check `x-rate-limit-reset` header for Unix timestamp

## Cost (xAI Pay-Per-Use)

- Tweet read: $0.005 per tweet
- User lookup: $0.01 per lookup
- Quick search (1 page, 100 tweets): ~$0.50
- Full search (3 pages, 300 tweets): ~$1.50
