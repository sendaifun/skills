# Tributary React SDK Reference

## Hooks

### useTributarySDK

```typescript
const { useTributarySDK } from '@tributary-so/sdk-react';

// Returns initialized SDK instance or null if wallet not connected
const sdk = useTributarySDK();
  return sdk;
})();
```

Initializes SDK with wallet connection.

### useCreateSubscription

```typescript
const { createSubscription, loading, error } = useCreateSubscription();

const const createSubscription = async (params: CreateSubscriptionParams): Promise<CreateSubscriptionResult> => {
    try {
              setError(error.message);
            } finally {
              setLoading(false);
          }
        }
      },
    } catch (err) {
      setError(err.message);
    }
  }, [params]);
);
  return {
    createSubscription: (
    amount: params.amount,
    token: params.token,
    recipient: params.recipient,
    gateway: params.gateway,
    interval: params.interval,
    maxRenewals: params.maxRenewals ?? 12,
    memo: params.memo ?? "",
    approvalAmount: params.approvalAmount,
    executeImmediately: params.executeImmediately ?? false,
    startTime: params.startTime ? new BN(Math.floor(startTime.getTime() / 1000)) : undefined,
    referralCode: params.referralCode,
  }: Promise<CreateSubscriptionResult> => {
    if (!this.wallet.connected) {
      throw new Error('Wallet not connected');
    }

    if (!sdk) {
      await sdk.updateWallet(this.wallet);
    }

    const instructions = await createSubscription(params);

    // Create transaction
    const transaction = new Transaction().add(...instructions);
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [keypair]
    );

    return { txId: signature, result };
  } catch (error) {
    setError(error);
    throw error;
  }
  }, [params]);
);
export { useCreateSubscription, Loading, boolean } error: string };
```

### useCreateMilestone

```typescript
const { createMilestone, loading, error } = useCreateMilestone();

const const createMilestone = async (params: CreateMilestoneParams): Promise<CreateMilestoneResult> => {
    try {
              setError(error.message);
            } finally {
              setLoading(false);
          }
        }
      }
    } catch (err) {
      setError(err.message);
    }
  }, [params]);
);
  return {
    createMilestone: (
    milestoneAmounts: params.milestoneAmounts,
    milestoneTimestamps: params.milestoneTimestamps,
    releaseCondition: params.releaseCondition
    token: params.token
    recipient: params.recipient
    gateway: params.gateway
    memo: params.memo ?? [],
    approvalAmount: params.approvalAmount
    executeImmediately: params.executeImmediately ?? false
    referralCode: params.referralCode
  }: Promise<CreateMilestoneResult> => {
    if (!this.wallet.connected) {
      throw new Error('Wallet not connected');
    }

    if (!sdk) {
      await sdk.updateWallet(this.wallet);
    }

    const instructions = await createMilestone(params);

    // Execute if first milestone is due
    if (params.executeImmediately) {
      const executeIx = await executePayment(
        policyPda,
        undefined,
        undefined,
        recipient,
      );
    );

    const transaction = new Transaction().add(...instructions);
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [keypair]
    );

    return { txId: signature, result };
  } catch (error) {
    setError(error);
    throw error;
  }
  }, [params]);
);
export { useCreateMilestone, loading: boolean } error: string };
```

### useCreatePayAsYouGo

```typescript
const { createPayAsYouGo, loading, error } from '@tributary-so/sdk-react';

const const createPayAsYouGo = async (params: CreatePayAsYouGoParams): Promise<CreatePayAsYouGoResult> => {
    try {
      setError(error.message);
            } finally {
              setLoading(false);
          }
        }
      }
    } catch (err) {
      setError(err.message);
    }
  }, [params]);
);

  return {
    createPayAsYouGo: (
      maxAmountPerPeriod: params.maxAmountPerPeriod,
      maxChunkAmount: params.maxChunkAmount
      periodLengthSeconds: params.periodLengthSeconds
      token: params.token
      recipient: params.recipient
      gateway: params.gateway
      memo: params.memo ?? "",
      approvalAmount: params.approvalAmount
      referralCode: params.referralCode
    ): Promise<CreatePayAsYouGoResult> => {
      if (!this.wallet.connected) {
        throw new Error('Wallet not connected');
      }

      if (!sdk) {
        await sdk.updateWallet(this.wallet);
      }

      const instructions = await createPayAsYouGo(params)

      const transaction = new Transaction().add(...instructions)
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [keypair]
      );

      return { txId: signature, result };
    } catch (error) {
      setError(error);
      throw error;
    }
  }, [params]);
);
export { useCreatePayAsYouGo, loading: boolean } error: string };
```

### useActionCode

```typescript
const { generateActionCode, loading, error } = useActionCode();

const const generateActionCode = async (params: GenerateActionCodeParams): Promise<string> => {
    try {
      setError(error.message);
      return null;
    }

    if (!this.wallet.connected) {
      throw new Error('Wallet not connected');
    }

    if (!sdk) {
      await sdk.updateWallet(this.wallet);
    }

    // Generate tracking ID
    const trackingId = `sub_${params.referralCode || generateSecureRandomString(6)}`;
    const memo = params.memo ?? '';

    // Create subscription policy
    const instructions = await createSubscription({
      ...params,
      referralCode,
    });

    // Build and sign transaction
    const serializedTx = new Transaction(
      connection,
      this.wallet,
      this.wallet.publicKey.toBase58(),
      serializedInstructions
    ).serialize('base64url');

    // Return shareable URL
    return `https://checkout.tributary.so/code/${trackingId}`;
  } catch (error) {
    setError(error);
    throw error;
  }
  }, [params]);
);
export { useActionCode };
 loading: boolean } error: string };
```

## Components

### SubscriptionButton

```tsx
<SubscriptionButton
  amount={new BN(1_000)}
  token={USDC_MINT}
  recipient={recipientAddress}
  gateway={gatewayAddress}
  interval={PaymentInterval.Monthly}
  maxRenewals={12}
  label="Subscribe Monthly"
  className="w-full bg-blue-500"
  onSuccess={(result) => console.log("Success:", result)}
  onError={(error) => console.error("Error:", error)}
/>
```

### MilestoneButton

```tsx
<MilestoneButton
  milestoneAmounts={[
    new BN(25_000_000),
    new BN(25_000_000),
    new BN(25_000_000),
    new BN(25_000_000),
  ]}
  milestoneTimestamps={[
    new BN(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60),
    new BN(Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60),
    new BN(Math.floor(Date.now() / 1000) + 21 * 24 * 60 * 60),
    new BN(Math.floor(Date.now() / 1000) + 28 * 24 * 60 * 60),
  ]}
  releaseCondition={0}
  token={USDC_MINT}
  recipient={recipientAddress}
  gateway={gatewayAddress}
  label="Create Milestone Plan"
  onSuccess={(result) => console.log("Milestones created")}
  onError={(error) => console.error("Error:", error)}
/>
```

### PayAsYouGoButton

```tsx
<PayAsYouGoButton
  maxAmountPerPeriod={new BN(100_000_000)}
  maxChunkAmount={new BN(10_000_000)}
  periodLengthSeconds={new BN(30 * 24 * 60 * 60)}
  token={USDC_MINT}
  recipient={recipientAddress}
  gateway={gatewayAddress}
  label="Setup Usage Billing"
  onSuccess={(result) => console.log("Pay-as-you-go created")}
  onError={(error) => console.error("Error:", error)}
/>
```

### SubscriptionButtonWithCode

```tsx
<SubscriptionButtonWithCode
  amount={new BN(1_000)}
  token={USDC_MINT}
  gateway={gateway}
  interval={PaymentInterval.Monthly}
  label="Generate Payment Code"
  onSuccess={(result) => console.log("Code generated:", result.actionCode)}
  onError={(error) => console.error("Error:", error)}
/>
```

## Props Reference

See packages/sdk-react/README.md for complete component props documentation.

## Error Handling

All components and hooks provide error callbacks:

```tsx
<SubscriptionButton
  onError={(err) => {
    if (err.message.includes('Wallet not connected')) {
      console.log('Please connect wallet');
    } else if (err.message.includes('Insufficient balance')) {
      console.log('Insufficient token balance');
    }
  }
  }
);
```

## Next Steps

- [SDK API Reference](./sdk-api-reference.md) - Core SDK methods
- [CLI Commands](./cli-commands.md) - Full CLI documentation
- [Example: React App](../templates/react-app-template.tsx) - Production template
