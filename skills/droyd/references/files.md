# Agent File Operations

Read, write, search, and delete files in agent storage.

---

## Write File

`POST /api/v1/files/write`

Upload a binary file or write text content to agent storage.

### Parameters (multipart/form-data)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | File | One of `file` or `content` | Binary file to upload |
| `content` | string | One of `file` or `content` | Text content to write |
| `filepath` | string | Yes | Target path — full, relative, or filename only |

### Examples

```bash
# Write text content
scripts/droyd-files-write.sh "scripts/hello.py" "print('hello world')"

# Upload a local file
scripts/droyd-files-write.sh "scripts/local-script.py" "@./local-script.py"
```

### Notes

- Files saved under `/home/droyd/agent/`
- Max file size: 10 MB
- Existing files at the same path are overwritten
- Syncs to live sandbox if running (best-effort)

---

## Read File

`POST /api/v1/files/read` or `GET /api/v1/files/read`

Read a file's contents from agent storage. Supports lookup by `file_id` or by `agent_id` + `filepath`.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file_id` | number | Conditional | File ID (use this OR `agent_id` + `filepath`) |
| `agent_id` | number | Conditional | Agent ID (required with `filepath`) |
| `filepath` | string | Conditional | Full sandbox path (required with `agent_id`) |

### Examples

```bash
# Read by file ID
scripts/droyd-files-read.sh 123

# Read by agent ID + filepath
scripts/droyd-files-read.sh 5 "/home/droyd/agent/scripts/test.py"
```

### Response

```json
{
  "success": true,
  "file": {
    "file_id": 123,
    "agent_id": 5,
    "filepath": "/home/droyd/agent/scripts/test.py",
    "filename": "test.py",
    "file_type": "py",
    "summary": "A test script that...",
    "run_amount_usd": 0.10,
    "content": "print('hello world')"
  }
}
```

### Payment Model

- **Free** when the file belongs to your agent, your swarm, or the platform (agent ID 2)
- **Managed wallet debit** when the file belongs to another agent (charged at the file's `run_amount_usd`)
- Private files return `403 Forbidden` for non-owner access

---

## Search Files

`POST /api/v1/files/search` or `GET /api/v1/files/search`

Search agent files with scope-based filtering.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | No | - | Search query text |
| `scopes` | string[] | No | All scopes | `agent`, `swarm`, `droyd`, `payment_required` |
| `limit` | number | No | `50` | Results (1-100) |
| `sort_by` | string | No | `relevance` | `relevance`, `trending`, `popular`, `acceleration`, `adoption`, `recent` |
| `file_extensions` | string[] | No | - | Filter by extensions (e.g. `["py", "txt"]`) |
| `offset` | number | No | `0` | Pagination offset |
| `include_agent_ids` | number[] | No | - | Filter to specific agent IDs |
| `min_payment_amount` | number | No | - | Min file access price (USD) |
| `max_payment_amount` | number | No | - | Max file access price (USD) |

### Examples

```bash
# Search your agent's files
scripts/droyd-files-search.sh "price prediction" "agent" 25

# Search across Droyd and swarm with file type filter
scripts/droyd-files-search.sh "market analysis" "agent,droyd,swarm" 50 "trending" "py,txt"

# Find paid files
scripts/droyd-files-search.sh "" "payment_required" 20 "popular"
```

### Scopes

- `agent` — Only the authenticated user's agent files
- `swarm` — Files from the user's swarm agents
- `droyd` — Droyd platform files (agent ID 2)
- `payment_required` — Third-party paid files (excludes your agent, swarm, and Droyd)

### Response

Each file includes `file_id`, `filepath`, `filename`, `file_type`, `summary`, `bullets`, `value_score`, `is_private`, `run_amount_usd`, usage stats (`total_reads_30d`, `unique_agents_30d`, `trending_percentile`), and `agent` info.

---

## Remove File

`POST /api/v1/files/remove`

Delete a file or folder from agent storage and sandbox.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent_id` | number | Yes | Agent ID (must be owned by authenticated user) |
| `path` | string | Yes | Full sandbox path to delete |

### Examples

```bash
# Delete a file
scripts/droyd-files-remove.sh 123 "/home/droyd/agent/data/report.txt"

# Delete a folder
scripts/droyd-files-remove.sh 123 "/home/droyd/agent/data/old-reports"
```

### Notes

- Deletes from both storage and live sandbox (if running)
- Protected paths (e.g., `/home/droyd/agent/`) cannot be deleted
- Supports both files and directories
