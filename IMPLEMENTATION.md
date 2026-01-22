# SendAI Skills Plugin System - Implementation Guide

## Overview

The SendAI Skills Plugin System provides two complementary tools for exposing Solana development skills to Claude Code:

1. **CLI Installer (`sendai-skills`)** - Install skills directly to `~/.claude/skills/`
2. **MCP Server (`sendai-skills-mcp`)** - Dynamic skill serving via Model Context Protocol

---

## What's Implemented

### CLI Installer (`sendai-skills`)

A command-line tool for managing SendAI skills and plugins locally.

#### Commands

| Command | Description |
|---------|-------------|
| **Plugin Marketplace** | |
| `plugin list` | List all available plugins |
| `plugin install <plugin>` | Install a plugin (skills, commands, agents, MCP) |
| `plugin remove <plugin>` | Remove an installed plugin |
| `plugin info <plugin>` | Show detailed plugin information |
| **MCP Setup** | |
| `init` | Configure SendAI Skills as a Claude Code plugin (MCP server) |
| `init --skills <list>` | Configure with specific skills only |
| `init --remove` | Remove SendAI Skills from Claude Code |
| **Skill Management** | |
| `search <query>` | Search for skills by keyword |
| `info <skill>` | Show detailed information about a skill |
| `list` | List all available skills with installation status |
| `install <skills...>` | Install specific skills to Claude Code |
| `install --all` | Install all available skills |
| `remove <skills...>` | Remove installed skills |
| `update` | Update all installed skills to latest versions |

#### Features

- **Plugin Marketplace**: Install complete plugin packages with skills, commands, agents
- Fetches skills directly from GitHub repository
- Installs to `~/.claude/skills/sendai-<skill-name>/`
- Preserves full skill structure (SKILL.md, examples/, resources/, docs/, templates/)
- Shows installation status when listing
- Colorized output with progress spinners

#### Local Usage

```bash
# Plugin Marketplace (from repo root)
pnpm cli plugin list                    # List available plugins
pnpm cli plugin install solana-agent-kit # Install plugin
pnpm cli plugin info solana-agent-kit   # Plugin details
pnpm cli plugin remove solana-agent-kit # Remove plugin

# MCP Setup
pnpm cli init                    # Configure MCP server
pnpm cli init --remove           # Remove MCP server

# Skill Management
pnpm cli search defi             # Search for skills
pnpm cli info kamino             # Get skill details
pnpm cli list                    # List all skills
pnpm cli install kamino raydium helius
pnpm cli install --all
pnpm cli remove kamino
pnpm cli update

# Using node directly
node packages/cli/dist/index.js plugin list
node packages/cli/dist/index.js plugin install solana-agent-kit
node packages/cli/dist/index.js init
node packages/cli/dist/index.js search "token swap"
```

---

### MCP Server (`sendai-skills-mcp`)

A Model Context Protocol server that exposes skills dynamically to Claude Code.

#### Exposed Capabilities

**1. Tools**

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_skills` | List all available SendAI skills | None |
| `get_skill` | Get full content of a specific skill | `name`: skill name |
| `get_skill_resource` | Get a resource file from a skill | `skill`: skill name, `resource`: path |

**2. Prompts**

Each skill is registered as an invokable prompt:
- `kamino` - Kamino Finance DeFi development guide
- `helius` - Helius RPC and API infrastructure guide
- `raydium` - Raydium AMM development guide
- `drift-protocol` - Drift perpetual futures guide
- ... and all other skills

**3. Resources**

Supporting files exposed via `sendai://` URI scheme:
- `sendai://kamino/resources/klend-api-reference.md`
- `sendai://helius/examples/das-api.ts`
- `sendai://drift-protocol/templates/bot-template.ts`

#### Features

- Fetches skills from GitHub in real-time
- 5-minute cache to reduce API calls
- Skill filtering via `--skills` flag
- STDIO transport for Claude Code integration

#### Local Usage

```bash
# Start server (for testing)
node packages/mcp-server/dist/index.js

# With specific skills only
node packages/mcp-server/dist/index.js --skills kamino,raydium

# Add to Claude Code
claude mcp add sendai-skills -- node /path/to/packages/mcp-server/dist/index.js
```

---

## Project Structure

```
skills/
├── package.json                    # Root workspace config
├── pnpm-workspace.yaml            # pnpm workspace definition
├── packages/
│   ├── cli/                       # CLI installer package
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts           # CLI entry point
│   │       ├── commands/
│   │       │   ├── list.ts        # List command
│   │       │   ├── install.ts     # Install command
│   │       │   ├── remove.ts      # Remove command
│   │       │   └── update.ts      # Update command
│   │       └── utils/
│   │           ├── paths.ts       # Path utilities
│   │           └── github.ts      # GitHub API utilities
│   └── mcp-server/                # MCP server package
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts           # MCP server entry
│           └── skills.ts          # Skill loading utilities
└── skills/                        # Skill definitions (existing)
    ├── kamino/
    ├── helius/
    ├── raydium/
    └── ...
```

---

## Production Deployment Guide

### 1. Publishing to npm

#### Prerequisites

```bash
# Login to npm
npm login

# Verify package names are available
npm view sendai-skills
npm view sendai-skills-mcp
```

#### Publish Packages

```bash
# Build first
pnpm run build

# Publish CLI
cd packages/cli
pnpm publish --access public

# Publish MCP server
cd ../mcp-server
pnpm publish --access public
```

#### Using Published Packages

```bash
# Plugin Marketplace (Recommended)
npx sendai-skills plugin list                    # Browse available plugins
npx sendai-skills plugin install solana-agent-kit # Install complete plugin
npx sendai-skills plugin info solana-agent-kit   # Get plugin details
npx sendai-skills plugin remove solana-agent-kit # Remove plugin

# MCP Server Setup
npx sendai-skills init                           # Configure MCP server
npx sendai-skills init --skills kamino,raydium   # With specific skills only
npx sendai-skills init --remove                  # Remove from Claude Code

# Search & Discovery
npx sendai-skills search defi                    # Search for skills
npx sendai-skills info kamino                    # Get skill details

# Individual Skill Installation
npx sendai-skills list                           # List all skills
npx sendai-skills install kamino                 # Install skills locally

# MCP Server (Direct)
claude mcp add sendai-skills -- npx sendai-skills-mcp
```

---

### 2. Scoped Packages (Optional)

If you want to publish under an organization scope:

**Update package.json files:**

```json
// packages/cli/package.json
{
  "name": "@sendai/skills-cli",
  ...
}

// packages/mcp-server/package.json
{
  "name": "@sendai/skills-mcp",
  ...
}
```

**Publish:**

```bash
pnpm publish --access public
```

**Usage:**

```bash
npx @sendai/skills-cli list
claude mcp add sendai-skills -- npx @sendai/skills-mcp
```

---

### 3. Remote MCP Server Hosting

For a hosted MCP server accessible over HTTP/SSE instead of local STDIO.

#### Option A: Cloudflare Workers

**1. Create worker project:**

```bash
npx wrangler init sendai-skills-mcp-worker
```

**2. Update the MCP server to use SSE transport:**

```typescript
// src/index.ts for Cloudflare Worker
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

export default {
  async fetch(request: Request): Promise<Response> {
    const transport = new SSEServerTransport("/messages", response);
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};
```

**3. Deploy:**

```bash
npx wrangler deploy
```

**4. Use with Claude Code:**

```bash
claude mcp add sendai-skills --transport sse https://sendai-skills-mcp.workers.dev
```

#### Option B: Node.js Server (Express/Fastify)

**1. Create HTTP server wrapper:**

```typescript
// server.ts
import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "./mcp-server.js";

const app = express();

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  const server = createServer();
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  // Handle incoming messages
});

app.listen(3000, () => {
  console.log("MCP Server running on http://localhost:3000");
});
```

**2. Deploy to:**
- Railway
- Render
- Fly.io
- AWS Lambda + API Gateway
- Google Cloud Run

**3. Use with Claude Code:**

```bash
claude mcp add sendai-skills --transport sse https://your-server.com/sse
```

#### Option C: Streamable HTTP (Recommended for Production)

```typescript
// Using the new streamable HTTP transport
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
});
```

---

### 4. GitHub Actions for CI/CD

**`.github/workflows/publish.yml`:**

```yaml
name: Publish Packages

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - run: pnpm install
      - run: pnpm run build

      - run: cd packages/cli && pnpm publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - run: cd packages/mcp-server && pnpm publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

### 5. Version Management

**Bump versions before publishing:**

```bash
# Patch release (1.0.0 -> 1.0.1)
cd packages/cli && npm version patch
cd ../mcp-server && npm version patch

# Minor release (1.0.0 -> 1.1.0)
cd packages/cli && npm version minor
cd ../mcp-server && npm version minor

# Major release (1.0.0 -> 2.0.0)
cd packages/cli && npm version major
cd ../mcp-server && npm version major
```

---

## Usage Examples

### Claude Code Integration

**Add MCP server:**

```bash
# Local (development)
claude mcp add sendai-skills -- node /path/to/dist/index.js

# Published package
claude mcp add sendai-skills -- npx sendai-skills-mcp

# With specific skills
claude mcp add sendai-skills -- npx sendai-skills-mcp --skills kamino,helius

# Remote server
claude mcp add sendai-skills --transport sse https://mcp.sendai.fun/sse
```

**Verify:**

```bash
claude mcp list
```

**Remove:**

```bash
claude mcp remove sendai-skills
```

### In Claude Code Conversations

Once MCP is configured, you can ask Claude:

```
"List all available SendAI skills"
"Get the kamino skill for DeFi development"
"Show me the helius skill"
"Get the drift-protocol examples"
"What Solana development skills are available?"
```

Claude will automatically use the MCP tools to fetch and present the skills.

---

## Troubleshooting

### MCP Server Issues

**Server not starting:**
```bash
# Check for errors
node packages/mcp-server/dist/index.js 2>&1
```

**Skills not loading:**
- Check GitHub API rate limits
- Verify network connectivity
- Check if skills exist in the repository

### CLI Issues

**Permission denied:**
```bash
# Ensure ~/.claude/skills directory is writable
mkdir -p ~/.claude/skills
chmod 755 ~/.claude/skills
```

**Skill not found:**
```bash
# Verify skill exists
pnpm cli list
```

### Claude Code Issues

**MCP not recognized:**
```bash
# Re-add the MCP server
claude mcp remove sendai-skills
claude mcp add sendai-skills -- npx sendai-skills-mcp
```

**Tools not appearing:**
- Restart Claude Code
- Start a new conversation
- Verify MCP is listed: `claude mcp list`

---

## Future Enhancements

- [ ] Local skill bundling (ship skills with npm package)
- [ ] Skill search and filtering
- [ ] Skill versioning
- [ ] Offline mode for CLI
- [ ] Skill dependencies
- [ ] Custom skill repositories
- [ ] Authentication for private skills
- [ ] Usage analytics
- [ ] Skill ratings and recommendations
