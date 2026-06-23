/**
 * Inspect an arbitrary mint and produce a go/no-go RISK REPORT for an integrator
 * (exchange / wallet / custodian) BEFORE crediting, listing, or routing it.
 *
 * Run on devnet:
 *   npm install @solana/web3.js @solana/spl-token bs58 dotenv
 *   SOLANA_RPC=https://api.devnet.solana.com npx tsx inspect-unknown-mint.ts <MINT_ADDRESS>
 *
 * It reads the account's owning program, then (for Token-2022) its extension set, and
 * flags the dangerous ones: PermanentDelegate (seizure), TransferHook (transfers can be
 * gated/bricked), DefaultAccountState=Frozen (accounts unusable until thawed),
 * NonTransferable (soulbound), ConfidentialTransferMint (hidden amounts), TransferFeeConfig
 * (balances drift unless reconciled). Never assume an unknown mint is "just a token".
 */
import { Connection, PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getMint,
  getExtensionTypes,
  getDefaultAccountState,
  ExtensionType,
  AccountState,
} from "@solana/spl-token";
import "dotenv/config";

type Risk = "BLOCK" | "WARN" | "OK";

interface Finding {
  extension: string;
  risk: Risk;
  note: string;
}

// Integration risk per extension. Anything not listed is treated as OK (no elevated risk).
const RISK_RULES: Partial<Record<ExtensionType, { risk: Risk; note: string }>> = {
  [ExtensionType.PermanentDelegate]: {
    risk: "BLOCK",
    note: "A fixed authority can transfer or burn ANY holder's tokens — funds are seizable.",
  },
  [ExtensionType.TransferHook]: {
    risk: "BLOCK",
    note: "Every transfer calls a custom program; it can gate, freeze, or brick transfers.",
  },
  [ExtensionType.ConfidentialTransferMint]: {
    risk: "WARN",
    note: "Balances/amounts are encrypted; standard balance accounting cannot see real amounts.",
  },
  [ExtensionType.TransferFeeConfig]: {
    risk: "WARN",
    note: "A fee is withheld on every transfer; reconcile withheld amounts or balances drift.",
  },
  [ExtensionType.NonTransferable]: {
    risk: "WARN",
    note: "Soulbound: tokens cannot be transferred out. Do not list as tradable.",
  },
  [ExtensionType.MintCloseAuthority]: {
    risk: "WARN",
    note: "The mint can be closed by its authority; supply assumptions can change.",
  },
};

async function main() {
  const mintArg = process.argv[2];
  if (!mintArg) {
    console.error("Usage: npx tsx inspect-unknown-mint.ts <MINT_ADDRESS>");
    process.exit(1);
  }
  const connection = new Connection(
    process.env.SOLANA_RPC ?? "https://api.devnet.solana.com",
    "confirmed",
  );
  const mintPubkey = new PublicKey(mintArg);

  // 1. Determine the owning program. A Token-2022 mint is owned by TOKEN_2022_PROGRAM_ID.
  const accountInfo = await connection.getAccountInfo(mintPubkey);
  if (!accountInfo) {
    console.error("Mint account not found on this cluster.");
    process.exit(1);
  }
  const owner = accountInfo.owner;
  const isToken2022 = owner.equals(TOKEN_2022_PROGRAM_ID);
  const isClassic = owner.equals(TOKEN_PROGRAM_ID);

  console.log(`Mint:    ${mintPubkey.toBase58()}`);
  console.log(
    `Program: ${owner.toBase58()} ` +
      (isToken2022 ? "(Token-2022)" : isClassic ? "(classic SPL Token)" : "(NOT a token program!)"),
  );

  if (!isToken2022 && !isClassic) {
    console.log("\nVERDICT: NO-GO — account is not owned by a known token program.");
    return;
  }
  if (isClassic) {
    console.log("\nClassic SPL Token mint: no Token-2022 extensions are possible.");
    console.log("VERDICT: GO (standard token) — still verify decimals and mint/freeze authority off-chain.");
    return;
  }

  // 2. Token-2022: read the extension set from the mint's TLV data.
  const mintInfo = await getMint(connection, mintPubkey, "confirmed", TOKEN_2022_PROGRAM_ID);
  const present = getExtensionTypes(mintInfo.tlvData);

  const findings: Finding[] = [];
  for (const ext of present) {
    const name = ExtensionType[ext] ?? `Unknown(${ext})`;

    if (ext === ExtensionType.DefaultAccountState) {
      const ds = getDefaultAccountState(mintInfo);
      if (ds && ds.state === AccountState.Frozen) {
        findings.push({
          extension: name,
          risk: "BLOCK",
          note: "New accounts are created FROZEN; the freeze authority must thaw each one before use.",
        });
      } else {
        findings.push({ extension: name, risk: "OK", note: "Default state is not Frozen." });
      }
      continue;
    }

    const rule = RISK_RULES[ext as ExtensionType];
    findings.push(
      rule
        ? { extension: name, risk: rule.risk, note: rule.note }
        : { extension: name, risk: "OK", note: "No elevated integration risk." },
    );
  }

  console.log(`\nExtensions (${findings.length}):`);
  for (const f of findings) {
    console.log(`  [${f.risk.padEnd(5)}] ${f.extension} — ${f.note}`);
  }

  const blocks = findings.filter((f) => f.risk === "BLOCK");
  const warns = findings.filter((f) => f.risk === "WARN");

  console.log("\n----------------------------------------");
  if (blocks.length > 0) {
    console.log(
      `VERDICT: NO-GO — ${blocks.length} blocking extension(s): ${blocks.map((b) => b.extension).join(", ")}.`,
    );
    console.log("Do not credit / list / route without explicit, audited handling.");
  } else if (warns.length > 0) {
    console.log(
      `VERDICT: GO WITH CARE — ${warns.length} warning(s): ${warns.map((w) => w.extension).join(", ")}.`,
    );
    console.log("Use transferChecked with correct decimals and reconcile any withheld fees.");
  } else {
    console.log("VERDICT: GO — no elevated-risk extensions detected.");
    console.log("Still pass TOKEN_2022_PROGRAM_ID to every helper and use transferChecked.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
