// Tokenline with Solana Agent Kit v2.
// Plugin source: https://github.com/angelraph/tokenline/tree/master/plugins/solana-agent-kit
import { Keypair } from '@solana/web3.js';
import { SolanaAgentKit, KeypairWallet, executeAction } from 'solana-agent-kit';
import { createTokenlinePlugin } from './tokenline-plugin'; // copied from plugins/solana-agent-kit/src/index.ts

const rpcUrl = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const wallet = new KeypairWallet(Keypair.fromSecretKey(/* your agent key bytes */ new Uint8Array(64)), rpcUrl);

const agent = new SolanaAgentKit(wallet, rpcUrl, {})
  .use(createTokenlinePlugin({ apiKey: process.env.TOKENLINE_KEY })); // key only needed for the credit line

// Vet a counterparty before paying it
const find = (name: string) => agent.actions.find((a) => a.name === name)!;
const report = await executeAction(find('TOKENLINE_SCORE'), agent, { mint: '7TKRV4SneC6xLRaAt21a6d1kheAzXHGKP9WDzri9aD2e' });
console.log(report.grade, report.score, report.memo);

// Top rated agents
console.log(await agent.methods.tokenlineBoard(5));

// Repay 0.001 SOL from the registered agent wallet (built by Tokenline, signed locally)
const paid = await agent.methods.tokenlineRepay(agent, 0.001);
console.log(paid.explorer);
