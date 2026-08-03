# Topic Framework

Use this reference to choose the strongest teaching angle for a Solana topic.

## Universal Explanation Flow

1. Name the concept in plain English.
2. Explain the problem it solves.
3. Identify the actors involved.
4. Show the state before the operation.
5. Walk through the operation step by step.
6. Show the state after the operation.
7. Connect the mental model to Solana implementation details.
8. Give one exercise that makes the learner manipulate the idea.

## Common Solana Topics

### Accounts

Teach accounts as persistent storage boxes on-chain. Emphasize:

- accounts hold data and lamports
- every account has an owner program
- only the owner program can change the account data
- users sign transactions, programs do not hold private keys

Best visuals:

- account box table
- owner arrows
- before/after data changes

### Transactions and Instructions

Teach a transaction as a signed envelope containing one or more instructions. Emphasize:

- the transaction is signed by required signers
- instructions name the program to run
- accounts are passed into instructions
- execution is atomic

Best visuals:

- envelope diagram
- ordered instruction timeline
- account read/write table

### Programs

Teach programs as stateless executable code. Emphasize:

- programs live in executable accounts
- program state is stored in separate accounts
- instructions are entrypoints into program logic
- upgrades depend on the program's upgrade authority

Best visuals:

- program-to-account relationship map
- instruction dispatch table

### PDAs

Teach PDAs as deterministic addresses controlled by a program, not by a private key. Emphasize:

- derived from seeds plus program id
- cannot be signed by a user private key
- the owning program can sign for a PDA during CPI with the correct seeds
- seeds are part of the app's address design

Best visuals:

- seed recipe diagram
- derived address output
- signer comparison table

### CPI

Teach CPI as one Solana program calling another program during one instruction. Emphasize:

- the outer program invokes another program
- accounts must be passed through correctly
- signer privileges can be forwarded
- PDA signing requires seeds

Best visuals:

- call stack
- actor lanes
- privilege forwarding table

### SPL Token

Teach SPL Token as a standard program for mints and balances. Emphasize:

- mint account defines the token
- token account holds a user's balance for one mint
- associated token account is the conventional token account for a wallet and mint
- mint authority creates supply
- owner authority controls a token account

Best visuals:

- mint-to-token-account relationship map
- authority table
- transfer state change

### Anchor

Teach Anchor as a framework that reduces Solana boilerplate. Emphasize:

- account validation happens before instruction logic
- constraints encode safety assumptions
- account structs describe required accounts
- errors should explain violated assumptions

Best visuals:

- instruction lifecycle
- account validation checklist
- Anchor macro to raw Solana concept mapping

