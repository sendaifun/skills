/**
 * token2022-client.ts — reusable Token-2022 helper module (web3.js + @solana/spl-token)
 * =====================================================================================
 *
 * Drop-in helpers that embody every rule from this skill's SKILL.md:
 *   - detect a mint's owning token program from `account.owner` (NEVER assume Token-2022)
 *   - thread the detected program id through ATA derivation and every instruction
 *   - create a mint with extensions in the CORRECT order (createAccount -> fixed-ext inits ->
 *     initializeMint -> variable-length metadata)
 *   - always use `transferChecked`, auto-selecting the fee / hook variant when needed
 *
 * Pinned versions: @solana/web3.js 1.98.4, @solana/spl-token 0.4.14, @solana/spl-token-metadata 0.1.6.
 *   npm i @solana/web3.js@1.98.4 @solana/spl-token@0.4.14 @solana/spl-token-metadata@0.1.6
 *
 * For @solana/kit codebases use the Codama client `@solana-program/token-2022` 0.12.0 instead — see
 * resources/sdk-reference.md for the function-by-function mapping (confidential transfers are kit-only).
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  clusterApiUrl,
  type Cluster,
  type Commitment,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AccountState,
  ExtensionType,
  TYPE_SIZE,
  LENGTH_SIZE,
  getMint,
  getMintLen,
  getTokenMetadata,
  getAssociatedTokenAddressSync,
  programSupportsExtensions,
  getTransferHook,
  getTransferFeeConfig,
  calculateEpochFee,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createInitializeTransferHookInstruction,
  createInitializeInterestBearingMintInstruction,
  createInitializeNonTransferableMintInstruction,
  createInitializePermanentDelegateInstruction,
  createInitializeMintCloseAuthorityInstruction,
  createInitializeDefaultAccountStateInstruction,
  createInitializeMetadataPointerInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  createTransferCheckedInstruction,
  createTransferCheckedWithFeeInstruction,
  createTransferCheckedWithTransferHookInstruction,
} from '@solana/spl-token';
import {
  createInitializeInstruction as createInitializeMetadataInstruction,
  createUpdateFieldInstruction,
  pack,
  type TokenMetadata,
} from '@solana/spl-token-metadata';

// ---------------------------------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------------------------------

export function getConnection(cluster: Cluster = 'devnet', commitment: Commitment = 'confirmed'): Connection {
  return new Connection(clusterApiUrl(cluster), commitment);
}

// ---------------------------------------------------------------------------------------------------
// Program detection (the single most important Token-2022 integration rule)
// ---------------------------------------------------------------------------------------------------

/**
 * Return the token program that OWNS a mint by reading its account `.owner`. The owning program is
 * fixed at creation and is NOT stored inside the mint data. There is no `getTokenProgramForMint` in
 * @solana/spl-token — this is it. Pass the result to `getMint`, ATA derivation, and every instruction.
 */
export async function getTokenProgramForMint(connection: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`Mint ${mint.toBase58()} not found`);
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new Error(`Not a token mint — owner is ${info.owner.toBase58()}`);
}

/**
 * Derive the ATA for `(owner, mint)` UNDER the mint's owning program. The token program id is a PDA
 * seed, so a Token-2022 ATA differs from a classic ATA for the same pair — using the wrong program
 * yields a different address and "wrong owner" failures.
 */
export async function getAtaForMint(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
): Promise<{ ata: PublicKey; programId: PublicKey }> {
  const programId = await getTokenProgramForMint(connection, mint);
  const ata = getAssociatedTokenAddressSync(mint, owner, false, programId);
  return { ata, programId };
}

// ---------------------------------------------------------------------------------------------------
// Mint creation (correct extension-init order)
// ---------------------------------------------------------------------------------------------------

export interface CreateMintOptions {
  connection: Connection;
  payer: Keypair;
  decimals: number;
  mintAuthority: PublicKey;
  /** null = no freeze authority. Required (or null) for DefaultAccountState mints to thaw later. */
  freezeAuthority?: PublicKey | null;
  /** Reuse a vanity/known mint keypair; one is generated otherwise. */
  mintKeypair?: Keypair;

  // --- Fixed-length mint extensions (initialized BEFORE initializeMint) ---
  transferFee?: {
    feeBasisPoints: number;
    maximumFee: bigint;
    configAuthority: PublicKey | null;
    withdrawAuthority: PublicKey | null;
  };
  transferHook?: { programId: PublicKey; authority: PublicKey | null };
  interestBearing?: { rate: number; rateAuthority: PublicKey }; // rate = i16 basis points / year
  nonTransferable?: boolean; // soulbound; PERMANENT
  permanentDelegate?: PublicKey; // trust hazard — can move/burn any holder's tokens
  mintCloseAuthority?: PublicKey;
  defaultAccountState?: AccountState; // e.g. AccountState.Frozen for allowlist gating

  // --- Variable-length metadata (initialized AFTER initializeMint; pointer points to the mint) ---
  metadata?: {
    name: string;
    symbol: string;
    uri: string;
    updateAuthority: PublicKey;
    additionalMetadata?: [string, string][];
  };
}

/**
 * Create a Token-2022 mint with any combination of the supported extensions, in the one and only
 * order the program accepts. Returns the mint address. Sends a single transaction.
 */
export async function createMintWithExtensions(opts: CreateMintOptions): Promise<PublicKey> {
  const { connection, payer, decimals, mintAuthority } = opts;
  const freezeAuthority = opts.freezeAuthority ?? null;
  const mintKp = opts.mintKeypair ?? Keypair.generate();
  const mint = mintKp.publicKey;

  // Accumulate the FIXED-length extensions and their init instructions together so getMintLen and the
  // instruction list never drift out of sync.
  const extensionTypes: ExtensionType[] = [];
  const preInitIxs: TransactionInstruction[] = [];

  if (opts.transferFee) {
    extensionTypes.push(ExtensionType.TransferFeeConfig);
    preInitIxs.push(
      createInitializeTransferFeeConfigInstruction(
        mint,
        opts.transferFee.configAuthority,
        opts.transferFee.withdrawAuthority,
        opts.transferFee.feeBasisPoints,
        opts.transferFee.maximumFee,
        TOKEN_2022_PROGRAM_ID,
      ),
    );
  }
  if (opts.transferHook) {
    extensionTypes.push(ExtensionType.TransferHook);
    preInitIxs.push(
      createInitializeTransferHookInstruction(
        mint,
        opts.transferHook.authority ?? PublicKey.default,
        opts.transferHook.programId,
        TOKEN_2022_PROGRAM_ID,
      ),
    );
  }
  if (opts.interestBearing) {
    extensionTypes.push(ExtensionType.InterestBearingConfig);
    preInitIxs.push(
      createInitializeInterestBearingMintInstruction(
        mint,
        opts.interestBearing.rateAuthority,
        opts.interestBearing.rate,
        TOKEN_2022_PROGRAM_ID,
      ),
    );
  }
  if (opts.nonTransferable) {
    extensionTypes.push(ExtensionType.NonTransferable);
    preInitIxs.push(createInitializeNonTransferableMintInstruction(mint, TOKEN_2022_PROGRAM_ID));
  }
  if (opts.permanentDelegate) {
    extensionTypes.push(ExtensionType.PermanentDelegate);
    preInitIxs.push(
      createInitializePermanentDelegateInstruction(mint, opts.permanentDelegate, TOKEN_2022_PROGRAM_ID),
    );
  }
  if (opts.mintCloseAuthority) {
    extensionTypes.push(ExtensionType.MintCloseAuthority);
    preInitIxs.push(
      createInitializeMintCloseAuthorityInstruction(mint, opts.mintCloseAuthority, TOKEN_2022_PROGRAM_ID),
    );
  }
  if (opts.defaultAccountState !== undefined) {
    extensionTypes.push(ExtensionType.DefaultAccountState);
    preInitIxs.push(
      createInitializeDefaultAccountStateInstruction(mint, opts.defaultAccountState, TOKEN_2022_PROGRAM_ID),
    );
  }
  // In-mint metadata requires a MetadataPointer (fixed) pointing at the mint itself.
  if (opts.metadata) {
    extensionTypes.push(ExtensionType.MetadataPointer);
    preInitIxs.push(
      createInitializeMetadataPointerInstruction(
        mint,
        opts.metadata.updateAuthority,
        mint, // metadata stored in the mint account
        TOKEN_2022_PROGRAM_ID,
      ),
    );
  }

  // Size the account for the FIXED extensions; size variable-length metadata separately for rent.
  const mintLen = getMintLen(extensionTypes);
  let metadataLen = 0;
  if (opts.metadata) {
    const meta: TokenMetadata = {
      mint,
      name: opts.metadata.name,
      symbol: opts.metadata.symbol,
      uri: opts.metadata.uri,
      additionalMetadata: opts.metadata.additionalMetadata ?? [],
    };
    metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(meta).length;
  }
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      space: mintLen, // fixed extensions only; metadata reallocs later, rent already funded
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    ...preInitIxs,
    createInitializeMintInstruction(mint, decimals, mintAuthority, freezeAuthority, TOKEN_2022_PROGRAM_ID),
  );

  // Variable-length metadata: name/symbol/uri AFTER initializeMint, then each additional field.
  if (opts.metadata) {
    tx.add(
      createInitializeMetadataInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mint,
        updateAuthority: opts.metadata.updateAuthority,
        mint,
        mintAuthority,
        name: opts.metadata.name,
        symbol: opts.metadata.symbol,
        uri: opts.metadata.uri,
      }),
    );
    for (const [field, value] of opts.metadata.additionalMetadata ?? []) {
      tx.add(
        createUpdateFieldInstruction({
          programId: TOKEN_2022_PROGRAM_ID,
          metadata: mint,
          updateAuthority: opts.metadata.updateAuthority,
          field,
          value,
        }),
      );
    }
  }

  await sendAndConfirmTransaction(connection, tx, [payer, mintKp]);
  return mint;
}

// ---------------------------------------------------------------------------------------------------
// ATA + mint helpers (program-aware)
// ---------------------------------------------------------------------------------------------------

/** Create the ATA for `(owner, mint)` if missing; returns its address. Safe to call repeatedly. */
export async function createAtaIdempotent(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  const { ata, programId } = await getAtaForMint(connection, mint, owner);
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey, ata, owner, mint, programId, ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    ),
    [payer],
  );
  return ata;
}

/** Mint `amount` base units to `destOwner`'s ATA (created idempotently). Uses the checked variant. */
export async function mintToChecked(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  destOwner: PublicKey,
  amount: bigint,
  mintAuthority: Keypair,
): Promise<string> {
  const programId = await getTokenProgramForMint(connection, mint);
  const { decimals } = await getMint(connection, mint, 'confirmed', programId);
  const ata = getAssociatedTokenAddressSync(mint, destOwner, false, programId);

  const signers = [payer];
  if (!mintAuthority.publicKey.equals(payer.publicKey)) signers.push(mintAuthority);

  return sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey, ata, destOwner, mint, programId, ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
      createMintToCheckedInstruction(mint, ata, mintAuthority.publicKey, amount, decimals, [], programId),
    ),
    signers,
  );
}

// ---------------------------------------------------------------------------------------------------
// Smart transfer: auto-select checked / withFee / withTransferHook based on the mint's extensions
// ---------------------------------------------------------------------------------------------------

/**
 * Transfer `amount` base units from `owner` to `destOwner`, picking the correct builder:
 *   - TransferHook mint  -> createTransferCheckedWithTransferHookInstruction (resolves extra accounts)
 *   - TransferFee mint   -> createTransferCheckedWithFeeInstruction (exact epoch fee via calculateEpochFee)
 *   - otherwise          -> createTransferCheckedInstruction
 * The destination ATA is created (idempotent) FIRST so hook account-resolution sees a real account.
 */
export async function transferSmart(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: Keypair,
  destOwner: PublicKey,
  amount: bigint,
): Promise<string> {
  const programId = await getTokenProgramForMint(connection, mint);
  const mintState = await getMint(connection, mint, 'confirmed', programId);
  const decimals = mintState.decimals;

  const source = getAssociatedTokenAddressSync(mint, owner.publicKey, false, programId);
  const dest = getAssociatedTokenAddressSync(mint, destOwner, false, programId);

  // Ensure the destination ATA exists before building the transfer (esp. for hook resolution).
  await createAtaIdempotent(connection, payer, mint, destOwner);

  let transferIx: TransactionInstruction | undefined;
  if (programSupportsExtensions(programId)) {
    const hook = getTransferHook(mintState); // null if no TransferHook extension
    const fee = getTransferFeeConfig(mintState); // null if no TransferFeeConfig extension
    if (hook && !hook.programId.equals(PublicKey.default)) {
      transferIx = await createTransferCheckedWithTransferHookInstruction(
        connection, source, mint, dest, owner.publicKey, amount, decimals, [], 'confirmed', programId,
      );
    } else if (fee) {
      const epoch = BigInt((await connection.getEpochInfo()).epoch);
      const exactFee = calculateEpochFee(fee, epoch, amount); // = min(amount*bps/10_000, maximumFee)
      transferIx = createTransferCheckedWithFeeInstruction(
        source, mint, dest, owner.publicKey, amount, decimals, exactFee, [], programId,
      );
    }
  }
  if (!transferIx) {
    transferIx = createTransferCheckedInstruction(
      source, mint, dest, owner.publicKey, amount, decimals, [], programId,
    );
  }

  const signers = [payer];
  if (!owner.publicKey.equals(payer.publicKey)) signers.push(owner);
  return sendAndConfirmTransaction(connection, new Transaction().add(transferIx), signers);
}

// ---------------------------------------------------------------------------------------------------
// Read in-mint metadata
// ---------------------------------------------------------------------------------------------------

/** Read the in-mint TokenMetadata (name/symbol/uri/additional), or null if the mint has none. */
export async function readMetadata(connection: Connection, mint: PublicKey): Promise<TokenMetadata | null> {
  const programId = await getTokenProgramForMint(connection, mint);
  return getTokenMetadata(connection, mint, 'confirmed', programId);
}
