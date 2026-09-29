// Tokenline with ElizaOS v1.
// Plugin source: https://github.com/angelraph/tokenline/tree/master/plugins/elizaos
import type { Character } from '@elizaos/core';
import { tokenlinePlugin } from './tokenline-plugin'; // copied from plugins/elizaos/src/index.ts

export const character: Character = {
  name: 'CreditAware',
  bio: ['Checks an agent\'s Tokenline grade before dealing with it.'],
  plugins: [],
  secrets: { TOKENLINE_KEY: process.env.TOKENLINE_KEY ?? '' }, // optional, only for the credit line
};

// Register the plugin with your runtime, for example:
//   const runtime = new AgentRuntime({ character, plugins: [tokenlinePlugin] });
//
// Then messages like these trigger the actions:
//   "Is 7TKRV4SneC6xLRaAt21a6d1kheAzXHGKP9WDzri9aD2e safe to deal with?"  -> TOKENLINE_SCORE
//   "Who are the best rated agents on Tokenline?"                         -> TOKENLINE_BOARD
//   "Any Tokenline upgrades or downgrades today?"                          -> TOKENLINE_WATCH
//   "How much compute credit do we have left?"                             -> TOKENLINE_CHECK_CREDIT
export { tokenlinePlugin };
