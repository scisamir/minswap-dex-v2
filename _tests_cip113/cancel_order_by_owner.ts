import {
  MeshTxBuilder,
  applyParamsToScript,
  deserializeAddress,
  deserializeDatum,
  mConStr1,
  byteString,
  conStr,
  conStr0,
  integer,
  list,
  stringToHex,
} from "@meshsdk/core";

import {
  blockchainProvider,
  orderValidatorScript,
  orderValidatorAddress,
  wallet1,
  wallet1Collateral,
  wallet1VK,
  orderValidatorRewardAddress,
  baseScript,
  userCip113Addr,
} from "./setup.js";

import {
  BLACKLIST_MINT_HASH,
  TOKEN_POLICY_ID,
  globalRewardAddr,
  transferLogicCbor,
  transferLogicHash,
  transferLogicRewardAddr,
  blacklistSpendAddr,
  registrySpendAddr,
  protocolParamsPolicyId,
  NETWORK_ID,
  getValidator,
} from "./programmableTokens/config.js";

console.log("=== Cancel Order By Owner ===");

const orderUtxos = await blockchainProvider.fetchAddressUTxOs(orderValidatorAddress);
const orderUtxo = orderUtxos[orderUtxos.length - 1];
if (!orderUtxo) {
  throw new Error("order utxo not found");
}
console.log(`Order UTxO: ${orderUtxo.input.txHash}#${orderUtxo.input.outputIndex}`);

const nonLovelaceUnits = orderUtxo.output.amount
  .map((a) => a.unit)
  .filter((u) => u !== "lovelace");
const programmableUnits = nonLovelaceUnits.filter((u) => u.length >= 56);
const hasProgrammableTokens = programmableUnits.length > 0;

const candidatePolicies = Array.from(
  new Set([
    ...programmableUnits.map((u) => u.slice(0, 56)),
  ])
);

const globalCbor = applyParamsToScript(
  getValidator("programmable_logic_global.programmable_logic_global.withdraw"),
  [byteString(protocolParamsPolicyId)],
  "JSON"
);
const protocolParamsUnit = protocolParamsPolicyId + stringToHex("ProtocolParams");
const protocolParamsAddresses = await blockchainProvider.fetchAssetAddresses(
  protocolParamsUnit
);
if (!protocolParamsAddresses.length) {
  throw new Error(
    `ProtocolParams asset not found on chain. Unit: ${protocolParamsUnit}`
  );
}
const protocolParamsAddressUtxos = await blockchainProvider.fetchAddressUTxOs(
  protocolParamsAddresses[0].address
);
const protocolParamsUtxo = protocolParamsAddressUtxos.find((u) =>
  u.output.amount.some((a) => a.unit === protocolParamsUnit)
);
if (!protocolParamsUtxo) throw new Error("ProtocolParams UTxO not found");

const baseRedeemer = conStr0([]);
let globalRedeemer: ReturnType<typeof conStr0> = conStr0([list([])]);
let transferRedeemer: ReturnType<typeof list> = list([]);
const sortedRefs: { txHash: string; outputIndex: number; label: string }[] = [
  {
    txHash: protocolParamsUtxo.input.txHash,
    outputIndex: protocolParamsUtxo.input.outputIndex,
    label: "protocolParams",
  },
];

if (hasProgrammableTokens) {
  console.log("\n=== Registry ===");
  const registryUtxos = await blockchainProvider.fetchAddressUTxOs(
    registrySpendAddr
  );
  let registryNodeUtxo: (typeof registryUtxos)[0] | null = null;
  let registryPolicy = "";

  for (const utxo of registryUtxos) {
    if (!utxo.output.plutusData) continue;
    try {
      const datum = deserializeDatum(utxo.output.plutusData);
      const policy = datum?.fields?.[0]?.bytes ?? "";
      if (candidatePolicies.includes(policy)) {
        registryNodeUtxo = utxo;
        registryPolicy = policy;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!registryNodeUtxo) {
    throw new Error(
      `Registry node not found for candidate policies: ${candidatePolicies.join(", ")}`
    );
  }

  const registryDatum = deserializeDatum(registryNodeUtxo.output.plutusData!);
  const registryTransferHash =
    registryDatum?.fields?.[2]?.fields?.[0]?.bytes ?? "";
  console.log("Registry policy:       ", registryPolicy);
  console.log("Registry transfer hash:", registryTransferHash);
  console.log("Local transfer hash:   ", transferLogicHash);
  if (registryTransferHash && registryTransferHash !== transferLogicHash) {
    throw new Error(
      `Config mismatch: registry transfer hash is ${registryTransferHash}, local transferLogicHash is ${transferLogicHash}`
    );
  }

  console.log("\n=== Blacklist Proof ===");
  const blacklistUtxos = await blockchainProvider.fetchAddressUTxOs(
    blacklistSpendAddr
  );
  const parsedOrderAddress = deserializeAddress(orderUtxo.output.address) as {
    stakeScriptCredentialHash?: string;
    stakeCredentialHash?: string;
    pubKeyHash?: string;
    scriptHash?: string;
  };
  const senderProofKeyHash =
    parsedOrderAddress.stakeScriptCredentialHash ??
    parsedOrderAddress.stakeCredentialHash ??
    parsedOrderAddress.pubKeyHash ??
    parsedOrderAddress.scriptHash;
  if (!senderProofKeyHash) {
    throw new Error("Could not derive sender proof key hash from order UTxO address");
  }
  console.log("Sender proof key hash:", senderProofKeyHash);

  const coveringNode = blacklistUtxos.find((blUtxo) => {
    if (!blUtxo.output.plutusData) return false;
    try {
      const hasBlacklistPolicy = blUtxo.output.amount.some(
        (a) => a.unit !== "lovelace" && a.unit.startsWith(BLACKLIST_MINT_HASH)
      );
      if (!hasBlacklistPolicy) return false;

      const datum = deserializeDatum(blUtxo.output.plutusData);
      const key = datum?.fields?.[0]?.bytes ?? "";
      const next = datum?.fields?.[1]?.bytes ?? "";
      return key < senderProofKeyHash && senderProofKeyHash < next;
    } catch {
      return false;
    }
  });

  if (!coveringNode) {
    throw new Error(
      `No blacklist covering node for key hash: ${senderProofKeyHash}`
    );
  }

  sortedRefs.push(
    {
      txHash: coveringNode.input.txHash,
      outputIndex: coveringNode.input.outputIndex,
      label: "blacklistNode",
    },
    {
      txHash: registryNodeUtxo.input.txHash,
      outputIndex: registryNodeUtxo.input.outputIndex,
      label: "registryNode",
    }
  );
  sortedRefs.sort((a, b) => {
    const cmp = a.txHash.toLowerCase().localeCompare(b.txHash.toLowerCase());
    return cmp !== 0 ? cmp : a.outputIndex - b.outputIndex;
  });

  const registryIndex = sortedRefs.findIndex(
    (r) =>
      r.txHash === registryNodeUtxo.input.txHash &&
      r.outputIndex === registryNodeUtxo.input.outputIndex
  );
  const proofIndex = sortedRefs.findIndex(
    (r) =>
      r.txHash === coveringNode.input.txHash &&
      r.outputIndex === coveringNode.input.outputIndex
  );
  if (registryIndex < 0 || proofIndex < 0) {
    throw new Error("Failed to compute reference input indices");
  }

  globalRedeemer = conStr0([list([conStr0([integer(registryIndex)])])]);
  transferRedeemer = list([conStr(0, [integer(proofIndex)])]);
} else {
  console.log("\n=== No Programmable Tokens In Order UTxO ===");
}

console.log("\n=== Building Transaction ===");
const walletUtxos = await wallet1.getUtxos();
const walletAddress = await wallet1.getChangeAddress();

const txBuilder = new MeshTxBuilder({
  fetcher: blockchainProvider,
  evaluator: blockchainProvider,
  submitter: blockchainProvider,
  verbose: true,
});

txBuilder
  .spendingPlutusScriptV3()
  .txIn(orderUtxo.input.txHash, orderUtxo.input.outputIndex)
  .txInInlineDatumPresent()
  .txInScript(baseScript)
  .txInRedeemerValue(baseRedeemer, "JSON");

for (const ref of sortedRefs) {
  txBuilder.readOnlyTxInReference(ref.txHash, ref.outputIndex);
}

txBuilder
  .txOut(userCip113Addr, orderUtxo.output.amount)
  .txOutInlineDatumValue(conStr0([]), "JSON")
  .withdrawalPlutusScriptV3()
  .withdrawal(globalRewardAddr, "0")
  .withdrawalScript(globalCbor)
  .withdrawalRedeemerValue(globalRedeemer, "JSON");

if (hasProgrammableTokens) {
  txBuilder
    .withdrawalPlutusScriptV3()
    .withdrawal(transferLogicRewardAddr, "0")
    .withdrawalScript(transferLogicCbor)
    .withdrawalRedeemerValue(transferRedeemer, "JSON");
}

txBuilder
  // Keep order-validator withdrawal in owner-cancel flow.
  .withdrawalPlutusScriptV3()
  .withdrawal(orderValidatorRewardAddress, "0")
  .withdrawalScript(orderValidatorScript)
  .withdrawalRedeemerValue(mConStr1([]))
  .requiredSignerHash(wallet1VK)
  .txInCollateral(wallet1Collateral.input.txHash, wallet1Collateral.input.outputIndex)
  .selectUtxosFrom(walletUtxos)
  .changeAddress(walletAddress);

txBuilder.setNetwork(NETWORK_ID === 0 ? "preview" : "mainnet");
console.log("Completing transaction...");
await txBuilder.complete();

const signedTx = await wallet1.signTx(txBuilder.txHex, false);
const txHash = await wallet1.submitTx(signedTx);

console.log("Cancel order by owner tx hash:", txHash);
