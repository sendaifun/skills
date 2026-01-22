---
name: setup-agent
description: Initialize a new Solana agent project with all required dependencies and configuration
---

# Setup Solana Agent Project

Create a new Solana AI agent project with the following structure:

## Steps

1. **Create project directory and initialize**
   ```bash
   mkdir $ARGUMENTS && cd $ARGUMENTS
   npm init -y
   ```

2. **Install dependencies**
   ```bash
   npm install solana-agent-kit \
     @solana-agent-kit/plugin-token \
     @solana-agent-kit/plugin-nft \
     @solana-agent-kit/plugin-defi \
     @solana-agent-kit/plugin-misc \
     @solana/web3.js \
     bs58 \
     dotenv
   ```

3. **Create .env file**
   ```
   RPC_URL=https://api.mainnet-beta.solana.com
   SOLANA_PRIVATE_KEY=your_base58_private_key
   OPENAI_API_KEY=your_openai_key
   ```

4. **Create agent.ts with basic setup**
   ```typescript
   import { SolanaAgentKit, createVercelAITools, KeypairWallet } from "solana-agent-kit";
   import TokenPlugin from "@solana-agent-kit/plugin-token";
   import DefiPlugin from "@solana-agent-kit/plugin-defi";
   import MiscPlugin from "@solana-agent-kit/plugin-misc";
   import { Keypair } from "@solana/web3.js";
   import bs58 from "bs58";
   import "dotenv/config";

   const privateKey = bs58.decode(process.env.SOLANA_PRIVATE_KEY!);
   const keypair = Keypair.fromSecretKey(privateKey);
   const wallet = new KeypairWallet(keypair);

   const agent = new SolanaAgentKit(
     wallet,
     process.env.RPC_URL!,
     { OPENAI_API_KEY: process.env.OPENAI_API_KEY! }
   )
     .use(TokenPlugin)
     .use(DefiPlugin)
     .use(MiscPlugin);

   export { agent };
   ```

5. **Add scripts to package.json**
   ```json
   {
     "scripts": {
       "dev": "ts-node agent.ts",
       "build": "tsc"
     }
   }
   ```

6. **Create tsconfig.json**
   ```json
   {
     "compilerOptions": {
       "target": "ES2020",
       "module": "commonjs",
       "esModuleInterop": true,
       "strict": true,
       "outDir": "./dist"
     }
   }
   ```

## Project Structure

```
$ARGUMENTS/
├── agent.ts           # Main agent setup
├── .env               # Environment variables
├── package.json       # Dependencies
├── tsconfig.json      # TypeScript config
└── README.md          # Project documentation
```

## Next Steps

After setup, you can:
- Add LangChain integration for conversational agents
- Configure the MCP server for Claude Desktop
- Add autonomous trading logic
- Implement custom actions
