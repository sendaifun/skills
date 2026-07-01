/**
 * examples/tests/bankrun.test.ts
 *
 * ⚠️ LEGACY PATH — for teams still on Anchor 0.30 / 0.31 (@coral-xyz/anchor).
 *
 * `solana-bankrun` / `anchor-bankrun` are frozen and were last published in 2024.
 * `anchor-bankrun` peer-depends on `@coral-xyz/anchor ^0.30.0` and consumes the older
 * v0.30 IDL — it does NOT support the new `@anchor-lang/core` (1.x) client. For NEW
 * (Anchor 1.x) code, prefer the LiteSVM test (see examples/tests/litesvm.test.ts) or a
 * Mollusk Rust test (examples/tests/mollusk.rs). This file is included so 0.3x codebases
 * migrating to this skill have a working reference.
 *
 * bankrun spins up an in-process BanksServer (from solana-program-test) — much faster
 * than a validator, with time/slot travel via `context.warpToSlot(...)`.
 *
 * Deps (0.3x world):
 *   @coral-xyz/anchor@^0.30.1  anchor-bankrun@^0.5.0  solana-bankrun@^0.4.0
 *   chai@^4  ts-mocha  @solana/web3.js@^1.98
 * Run: `anchor build` then `yarn ts-mocha -p ./tsconfig.json -t 1000000 examples/tests/bankrun.test.ts`
 *
 * NOTE the import scope below is `@coral-xyz/anchor`, NOT `@anchor-lang/core`.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { startAnchor, BankrunProvider } from "anchor-bankrun";
import { assert } from "chai";

// The generated IDL + type. `anchor build` writes both to target/. Under 0.30 the IDL
// carries `address`, so `new Program(idl, provider)` needs no explicit program id.
import { Counter } from "../../target/types/counter";
const IDL = require("../../target/idl/counter.json");

describe("counter (bankrun / legacy 0.3x)", () => {
  it("initialize then increment", async () => {
    // startAnchor(projectRoot, extraPrograms, extraAccounts). "" resolves programs from
    // Anchor.toml + target/deploy and loads them into the BanksServer.
    const context = await startAnchor("", [], []);
    const provider = new BankrunProvider(context);
    anchor.setProvider(provider);

    const program = new Program<Counter>(IDL, provider);
    const authority = provider.wallet.publicKey;

    // PDA seeds = [b"counter", authority] — MUST match the program (see counter/lib.rs).
    const [counterPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("counter"), authority.toBuffer()],
      program.programId,
    );

    await program.methods
      .initialize()
      .accountsPartial({ counter: counterPda, authority }) // counter is a PDA → accountsPartial (strict since 0.30)
      .rpc();

    let counter = await program.account.counter.fetch(counterPda);
    assert.strictEqual(counter.count.toNumber(), 0, "count is 0 after initialize");

    await program.methods
      .increment()
      .accountsPartial({ counter: counterPda, authority }) // counter is a PDA → accountsPartial (strict since 0.30)
      .rpc();

    counter = await program.account.counter.fetch(counterPda);
    assert.strictEqual(counter.count.toNumber(), 1, "count is 1 after increment");
  });
});
