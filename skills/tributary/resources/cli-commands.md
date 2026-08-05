# Tributary CLI Commands Reference

## Global Options

All commands require these global options:

| Option                       | Description               |
| ---------------------------- | ------------------------- |
| `-c, --connection-url <url>` | Solana RPC connection URL |
| `-k, --keypath <path>`       | Path to keypair JSON file |

## Commands

### Program Administration

```bash
tributary-cli initialize -a <ADMIN_PUBKEY>
```

Initialize the Tributary program.

**Options:**

- `-a, --admin <pubkey>`: Admin public key (required)

---

### Gateway Management

````bash
# Create gateway
tributary-cli create-gateway \
  -a <AUTHORITY_PUBKEY> \
  -f <FEE_BPS> \
  -r <FEE_RECIPIENT> \
  -n "Gateway Name" \
  -u "https://gateway.com"

# Delete gateway
tributary-cli delete-gateway -a <AUTHORITY_PUBKEY>

# Update gateway signer
tributary-cli change-gateway-signer \
  -a <AUTHORITY_PUBKEY> \
  -s <NEW_SIGNERPubkey>

# Update fee recipient
tributary-cli change-gateway-fee-recipient \
  -a <AUTHORITY_PUBKEY> \
  -r <NEW_RECIPIENTPubkey>

# Update fee BPS
tributary-cli change-gateway-fee-bps \
  -a <AUTHORITY_PUBKEY> \
  -f <NEWFeeBps>

# Configure referral program
tributary-cli update-gateway-referral-settings \
  -a <AUTHORITY_PUBKEY> \
  -f <FEATUREFlags> \
  -l <AllocationBps> \
  -t "L1,L2,L3"

**Options:**
- `-f, --feature-flags`: Feature flags (bit 0 = referral)
- `-l, --referral-allocation-bps`: Referral allocation (0-2500 bps)
- `-t, --referral-tiers-bps`: Comma-separated L1,L2,L3 BPS

---

### User Payment Management

```bash
# Create user payment account
tributary-cli create-user-payment -t <TOKEN_MINT>

# List user payments
tributary-cli list-user-payments

````

### Subscription Management

````bash
# Create subscription
tributary-cli create-subscription \
  -t <TOKEN_MINT> \
  -r <RECIPIENT> \
  -g <GATEWAY> \
  -a <AMOUNT> \
  [-f monthly] \
  [--auto-renew] \
  [--max-renewals 12] \
  [-m "Optional memo"]

**Options:**
- `-t, --token-mint <pubkey>`: Token mint (required)
- `-r, --recipient <pubkey>`: Payment recipient (required)
- `-g, --gateway <pubkey>`: Payment gateway (required)
- `-a, --amount <number>`: Payment amount (required)
- `-f, --frequency <string>`: Payment frequency (default: "monthly")
  - `--auto-renew`: Enable auto-renewal
  - `--max-renewals <number>`: Maximum renewals
  - `-m, --memo <string>`: Payment memo
  - `--execute-immediately`: Execute first payment

---

### Payment Execution

```bash
# Execute payment
tributary-cli execute-payment -u <USER_PAYMENT_PDA>
````

Execute pending payment.

---

### PDA Utilities

```bash
# Get config PDA
tributary-cli get-config-pda

# Get gateway PDA
tributary-cli get-gateway-pda -a <AUTHORITY_PUBKEY>

# Get user payment PDA
tributary-cli get-user-payment-pda \
  -u <USER_PUBKEY> \
  -t <TOKEN_MINT>

# Get payment policy PDA
tributary-cli get-payment-policy-pda \
  -u <USER_PAYMENT_PUBKEY> \
  -p <POLICY_ID>

# Get payments delegate PDA
tributary-cli get-payments-delegate-pda
```

### Inspection Commands

```bash
# List all gateways
tributary-cli list-gateways

# List policies by owner
tributary-cli list-policies-by-owner -o <OWNER_PUBKEY>

# List all payment policies
tributary-cli list-payment-policies
```

## Payment Frequencies

- `daily`: Every 24 hours
- `weekly`: Every 7 days
- `monthly`: Every 30 days
- `quarterly`: Every 90 days
- `semiAnnually`: Every 180 days
- `annually`: Every 365 days

## Examples

### Complete Workflow

```bash
# 1. Initialize program (admin only)
tributary-cli -c https://api.devnet.solana.com -k ~/.config/solana/id.json \
  initialize -a ADMIN_PUBKEY

# 2. Create gateway
tributary-cli create-gateway \
  -a AUTHORITY_PUBKEY \
  -f 500 \
  -r FEE_RECIPIENT \
  -n "My Gateway" \
  -u "https://mygateway.com"

# 3. Create subscription
tributary-cli create-subscription \
  -t USDC_MINT \
  -r RECIPIENT \
  -g GATEWAY_PUBKEY \
  -a 1000000 \
  -f monthly \
  --max-renewals 12

# 4. Execute payment
tributary-cli execute-payment -u USER_PAYMENT_PDA
```

### Referral Setup

```bash
# Enable referral program with 25% allocation,tributary-cli update-gateway-referral-settings \
  -a AUTHORITY_PUBKEY \
  -f 1 \
  -l 2500 \
  -t "5000,3000,2000"
```

## Error Codes

| Error               | Cause                           |
| ------------------- | ------------------------------- |
| `Keypair not found` | Invalid keypair file path       |
| `InsufficientFunds` | Not enough SOL for fees         |
| `AccountNotFound`   | Specified account doesn't exist |
| `InvalidAuthority`  | Wrong authority for operation   |
| `EmergencyPause`    | Protocol is paused              |

## Next Steps

- [SDK API Reference](./sdk-api-reference.md) - Core SDK methods
- [React Components](./react-hooks.md) - UI component reference
- [Example: React App](../templates/react-app-template.tsx) - Production template
