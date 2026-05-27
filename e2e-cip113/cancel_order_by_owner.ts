import {
  MeshTxBuilder,
  deserializeDatum,
  mConStr1,
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
  orderValidatorScriptHash,
  baseScript,
  userCip113Addr,
} from "./setup.js";

import {
  TOKEN_POLICY_ID,
  globalCbor,
  globalRewardAddr,
  transferLogicCbor,
  transferLogicHash,
  transferLogicRewardAddr,
  registrySpendAddr,
  protocolParamsPolicyId,
  NETWORK_ID,
  validateConfig,
} from "./purrfluid/config.js";
import { purrfluidUnit } from "./purrfluid/dexConfig.js";
import {
  fetchWhitelistProofs,
  uniqueWhitelistUtxos,
} from "./purrfluid/whitelistProofs.js";

console.log("=== Cancel Order By Owner ===");
validateConfig();

const orderUtxos = await blockchainProvider.fetchAddressUTxOs(orderValidatorAddress);
const orderUtxo = orderUtxos[orderUtxos.length - 1];
if (!orderUtxo) {
  throw new Error("order utxo not found");
}
console.log(`Order UTxO: ${orderUtxo.input.txHash}#${orderUtxo.input.outputIndex}`);

const hasPurrfluidTokens = orderUtxo.output.amount.some(
  (asset) => asset.unit === purrfluidUnit
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

if (hasPurrfluidTokens) {
  console.log("\n=== Registry ===");
  const registryUtxos = await blockchainProvider.fetchAddressUTxOs(
    registrySpendAddr
  );
  let registryNodeUtxo: (typeof registryUtxos)[0] | null = null;

  for (const utxo of registryUtxos) {
    if (!utxo.output.plutusData) continue;
    try {
      const datum = deserializeDatum(utxo.output.plutusData);
      if ((datum?.fields?.[0]?.bytes ?? "") === TOKEN_POLICY_ID) {
        registryNodeUtxo = utxo;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!registryNodeUtxo) {
    throw new Error(`Registry node not found for PurrFluid policy: ${TOKEN_POLICY_ID}`);
  }

  const registryDatum = deserializeDatum(registryNodeUtxo.output.plutusData!);
  const registryTransferHash =
    registryDatum?.fields?.[2]?.fields?.[0]?.bytes ?? "";
  console.log("Registry policy:       ", TOKEN_POLICY_ID);
  console.log("Registry transfer hash:", registryTransferHash);
  console.log("Local transfer hash:   ", transferLogicHash);
  if (registryTransferHash && registryTransferHash !== transferLogicHash) {
    throw new Error(
      `Config mismatch: registry transfer hash is ${registryTransferHash}, local transferLogicHash is ${transferLogicHash}`
    );
  }

  console.log("\n=== PurrFluid Whitelist Proofs ===");
  const proofs = await fetchWhitelistProofs([
    orderValidatorScriptHash,
    wallet1VK,
  ]);
  const whitelistUtxos = uniqueWhitelistUtxos(proofs);

  sortedRefs.push(
    ...whitelistUtxos.map((utxo) => ({
      txHash: utxo.input.txHash,
      outputIndex: utxo.input.outputIndex,
      label: "whitelistNode",
    })),
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
  const proofIndices = proofs.map((proof) =>
    sortedRefs.findIndex(
      (r) =>
        r.txHash === proof.utxo.input.txHash &&
        r.outputIndex === proof.utxo.input.outputIndex
    )
  );
  if (registryIndex < 0 || proofIndices.some((index) => index < 0)) {
    throw new Error("Failed to compute reference input indices");
  }

  globalRedeemer = conStr0([list([conStr0([integer(registryIndex)])])]);
  transferRedeemer = list(
    proofIndices.map((index) => conStr(0, [integer(index)]))
  );
} else {
  console.log("\n=== No PurrFluid Tokens In Order UTxO ===");
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

if (hasPurrfluidTokens) {
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
