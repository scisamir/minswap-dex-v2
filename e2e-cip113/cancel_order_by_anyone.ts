import {
  MeshTxBuilder,
  SLOT_CONFIG_NETWORK,
  conStr,
  conStr0,
  deserializeAddress,
  deserializeDatum,
  integer,
  list,
  mConStr2,
  serializeAddressObj,
  stringToHex,
  unixTimeToEnclosingSlot,
} from "@meshsdk/core";

import {
  NETWORK_ID,
  baseScript,
  blockchainProvider,
  orderCanclValidatorRewardAddress,
  orderCanclValidatorScript,
  orderValidatorAddress,
  orderValidatorRewardAddress,
  orderValidatorScript,
  orderValidatorScriptHash,
  wallet1,
  wallet1Address,
  wallet1Collateral,
  wallet1Utxos,
} from "./setup.js";
import {
  TOKEN_POLICY_ID,
  globalCbor,
  globalRewardAddr,
  protocolParamsPolicyId,
  registrySpendAddr,
  transferLogicCbor,
  transferLogicHash,
  transferLogicRewardAddr,
  validateConfig,
} from "./purrfluid/config.js";
import { purrfluidUnit } from "./purrfluid/dexConfig.js";
import {
  fetchWhitelistProofs,
  uniqueWhitelistUtxos,
} from "./purrfluid/whitelistProofs.js";

console.log("=== Cancel Expired Order ===");
validateConfig();

const orderUtxos =
  await blockchainProvider.fetchAddressUTxOs(orderValidatorAddress);
const orderUtxo = orderUtxos[orderUtxos.length - 1];
if (!orderUtxo || !orderUtxo.output.plutusData) {
  throw new Error("Order UTxO with datum not found");
}

const orderDatum = deserializeDatum(orderUtxo.output.plutusData);
const orderReceiverAddr = serializeAddressObj(orderDatum.fields[3], NETWORK_ID);
const hasPurrfluidTokens = orderUtxo.output.amount.some(
  (asset) => asset.unit === purrfluidUnit
);

const protocolParamsUnit =
  protocolParamsPolicyId + stringToHex("ProtocolParams");
const protocolParamsAddresses =
  await blockchainProvider.fetchAssetAddresses(protocolParamsUnit);
if (!protocolParamsAddresses.length) {
  throw new Error(`ProtocolParams asset not found: ${protocolParamsUnit}`);
}
const protocolParamsUtxos = await blockchainProvider.fetchAddressUTxOs(
  protocolParamsAddresses[0].address
);
const protocolParamsUtxo = protocolParamsUtxos.find((utxo) =>
  utxo.output.amount.some((asset) => asset.unit === protocolParamsUnit)
);
if (!protocolParamsUtxo) throw new Error("ProtocolParams UTxO not found");

type RefEntry = { txHash: string; outputIndex: number; label: string };
const refs: RefEntry[] = [
  {
    txHash: protocolParamsUtxo.input.txHash,
    outputIndex: protocolParamsUtxo.input.outputIndex,
    label: "protocolParams",
  },
];
let globalRedeemer: ReturnType<typeof conStr0> = conStr0([list([])]);
let transferRedeemer: ReturnType<typeof list> = list([]);

if (hasPurrfluidTokens) {
  const registryUtxos =
    await blockchainProvider.fetchAddressUTxOs(registrySpendAddr);
  const registryNode = registryUtxos.find((utxo) => {
    if (!utxo.output.plutusData) return false;
    try {
      const datum = deserializeDatum(utxo.output.plutusData);
      return (datum?.fields?.[0]?.bytes ?? "") === TOKEN_POLICY_ID;
    } catch {
      return false;
    }
  });
  if (!registryNode?.output.plutusData) {
    throw new Error(`Registry node not found for PurrFluid: ${TOKEN_POLICY_ID}`);
  }

  const registryDatum = deserializeDatum(registryNode.output.plutusData);
  const registeredTransferHash =
    registryDatum?.fields?.[2]?.fields?.[0]?.bytes ?? "";
  if (
    registeredTransferHash &&
    registeredTransferHash !== transferLogicHash
  ) {
    throw new Error(
      `Registry transfer hash ${registeredTransferHash} does not match PurrFluid transfer hash ${transferLogicHash}`
    );
  }

  const parsedReceiver = deserializeAddress(orderReceiverAddr) as {
    stakeScriptCredentialHash?: string;
    stakeCredentialHash?: string;
  };
  const receiverCredential =
    parsedReceiver.stakeScriptCredentialHash ??
    parsedReceiver.stakeCredentialHash;
  if (!receiverCredential) {
    throw new Error("Could not derive recipient whitelist credential");
  }

  const proofs = await fetchWhitelistProofs([
    orderValidatorScriptHash,
    receiverCredential,
  ]);
  refs.push(
    ...uniqueWhitelistUtxos(proofs).map((utxo) => ({
      txHash: utxo.input.txHash,
      outputIndex: utxo.input.outputIndex,
      label: "whitelistNode",
    })),
    {
      txHash: registryNode.input.txHash,
      outputIndex: registryNode.input.outputIndex,
      label: "registryNode",
    }
  );
  refs.sort((a, b) => {
    const cmp = a.txHash.toLowerCase().localeCompare(b.txHash.toLowerCase());
    return cmp !== 0 ? cmp : a.outputIndex - b.outputIndex;
  });

  const registryIndex = refs.findIndex(
    (ref) =>
      ref.txHash === registryNode.input.txHash &&
      ref.outputIndex === registryNode.input.outputIndex
  );
  const proofIndices = proofs.map((proof) =>
    refs.findIndex(
      (ref) =>
        ref.txHash === proof.utxo.input.txHash &&
        ref.outputIndex === proof.utxo.input.outputIndex
    )
  );
  if (registryIndex < 0 || proofIndices.some((index) => index < 0)) {
    throw new Error("Failed to compute PurrFluid reference input indices");
  }

  globalRedeemer = conStr0([list([conStr(0, [integer(registryIndex)])])]);
  transferRedeemer = list(
    proofIndices.map((index) => conStr(0, [integer(index)]))
  );
}

const invalidBefore = unixTimeToEnclosingSlot(
  Date.now() - 15000,
  SLOT_CONFIG_NETWORK.preview
);
const txBuilder = new MeshTxBuilder({
  fetcher: blockchainProvider,
  evaluator: blockchainProvider,
  submitter: blockchainProvider,
});

txBuilder
  .spendingPlutusScriptV3()
  .txIn(orderUtxo.input.txHash, orderUtxo.input.outputIndex)
  .txInInlineDatumPresent()
  .txInScript(baseScript)
  .txInRedeemerValue(conStr0([]), "JSON");

for (const ref of refs) {
  txBuilder.readOnlyTxInReference(ref.txHash, ref.outputIndex);
}

txBuilder
  .txOut(orderReceiverAddr, orderUtxo.output.amount)
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

const unsignedTx = await txBuilder
  .withdrawalPlutusScriptV3()
  .withdrawal(orderValidatorRewardAddress, "0")
  .withdrawalScript(orderValidatorScript)
  .withdrawalRedeemerValue(mConStr2([]))
  .withdrawalPlutusScriptV3()
  .withdrawal(orderCanclValidatorRewardAddress, "0")
  .withdrawalScript(orderCanclValidatorScript)
  .withdrawalRedeemerValue("")
  .txInCollateral(
    wallet1Collateral.input.txHash,
    wallet1Collateral.input.outputIndex,
    wallet1Collateral.output.amount,
    wallet1Collateral.output.address
  )
  .invalidBefore(invalidBefore)
  .changeAddress(wallet1Address)
  .selectUtxosFrom(wallet1Utxos)
  .setNetwork(NETWORK_ID === 0 ? "preview" : "mainnet")
  .complete();

const signedTx = await wallet1.signTx(unsignedTx);
const txHash = await wallet1.submitTx(signedTx);

console.log("Cancel expired order tx hash:", txHash);
