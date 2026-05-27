import {
  conStr,
  conStr0,
  deserializeDatum,
  integer,
  list,
  mConStr0,
  mConStr1,
  mScriptAddress,
  stringToHex,
} from "@meshsdk/core";
import {
  authenPolicyId,
  blockchainProvider,
  orderLovelaceAmount,
  orderValidatorAddress,
  orderValidatorScriptHash,
  txBuilder,
  wallet1,
  wallet1Address,
  wallet1Collateral,
  wallet1Utxos,
  wallet1VK,
  baseHash,
  swapAmount,
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
  validateConfig,
  wallet1SmartAddr,
  baseCbor,
} from "./purrfluid/config.js";
import {
  purrfluidAdaLpAssetName,
  purrfluidUnit,
} from "./purrfluid/dexConfig.js";
import {
  fetchWhitelistProofs,
  uniqueWhitelistUtxos,
} from "./purrfluid/whitelistProofs.js";

validateConfig();

const orderStep = mConStr0([
  mConStr0([]), // False (a_to_b_direction)
  mConStr0([swapAmount]), // swap_amount_option
  1, // minimum_receive
  mConStr0([]), // False
]);
const orderDatum = mConStr0([
  mConStr0([wallet1VK]),
  mScriptAddress(baseHash, wallet1VK),
  mConStr0([]),
  mScriptAddress(baseHash, wallet1VK),
  mConStr0([]),
  mConStr0([
    authenPolicyId,
    purrfluidAdaLpAssetName,
  ]),
  orderStep,
  6000000,
  mConStr1([]),
]);

console.log("=== Create Sell Order ===");
console.log("purrfluidAdaLpAssetName:", purrfluidAdaLpAssetName);

console.log("\n=== Registry ===");
const registryUtxos =
  await blockchainProvider.fetchAddressUTxOs(registrySpendAddr);
let registryNodeUtxo: (typeof registryUtxos)[0] | null = null;

for (const utxo of registryUtxos) {
  if (!utxo.output.plutusData) continue;
  try {
    const datum = deserializeDatum(utxo.output.plutusData);
    if ((datum?.fields?.[0]?.bytes ?? "") === TOKEN_POLICY_ID) {
      registryNodeUtxo = utxo;
      console.log(
        `Registry node: ${utxo.input.txHash}#${utxo.input.outputIndex}`
      );
      break;
    }
  } catch {
    continue;
  }
}

if (!registryNodeUtxo) {
  throw new Error(`Registry node not found for policy: ${TOKEN_POLICY_ID}`);
}

const registryDatum = deserializeDatum(registryNodeUtxo.output.plutusData!);
const registryTransferHash =
  registryDatum?.fields?.[2]?.fields?.[0]?.bytes ?? "";
console.log("Registry transfer hash:", registryTransferHash);
console.log("Local transfer hash:   ", transferLogicHash);
if (registryTransferHash && registryTransferHash !== transferLogicHash) {
  throw new Error(
    `Config mismatch: registry transfer hash is ${registryTransferHash}, local transferLogicHash is ${transferLogicHash}`
  );
}

const protocolParamsUnit = protocolParamsPolicyId + stringToHex("ProtocolParams");
const protocolParamsAddresses =
  await blockchainProvider.fetchAssetAddresses(protocolParamsUnit);
if (!protocolParamsAddresses.length) {
  throw new Error(
    `ProtocolParams asset not found on chain. Unit: ${protocolParamsUnit}`
  );
}
const protocolParamsAddressUtxos = await blockchainProvider.fetchAddressUTxOs(
  protocolParamsAddresses[0].address
);
const protocolParamsUtxo = protocolParamsAddressUtxos.find((u: (typeof protocolParamsAddressUtxos)[number]) =>
  u.output.amount.some((a: { unit: string }) => a.unit === protocolParamsUnit)
);
if (!protocolParamsUtxo) throw new Error("ProtocolParams UTxO not found");

console.log("\n=== Smart Wallet UTxOs ===");
const smartWalletUtxos =
  await blockchainProvider.fetchAddressUTxOs(wallet1SmartAddr);
if (!smartWalletUtxos.length) {
  throw new Error(`No UTxOs at sender smart wallet: ${wallet1SmartAddr}`);
}

const sendAmountBN = BigInt(swapAmount);
const selectedUtxos: typeof smartWalletUtxos = [];
let selectedBalance = 0n;

for (const utxo of smartWalletUtxos) {
  const qty = utxo.output.amount.find((a: { unit: string; quantity: string }) => a.unit === purrfluidUnit)?.quantity;
  if (!qty) continue;
  selectedUtxos.push(utxo);
  selectedBalance += BigInt(qty);
  if (selectedBalance >= sendAmountBN) break;
}

if (selectedBalance < sendAmountBN) {
  throw new Error(
    `Insufficient balance. Have ${selectedBalance}, need ${sendAmountBN}`
  );
}

const changeAmount = selectedBalance - sendAmountBN;
selectedUtxos.sort((a, b) => {
  const cmp = a.input.txHash
    .toLowerCase()
    .localeCompare(b.input.txHash.toLowerCase());
  return cmp !== 0 ? cmp : a.input.outputIndex - b.input.outputIndex;
});
console.log(
  `Selected ${selectedUtxos.length} UTxO(s), balance=${selectedBalance}, change=${changeAmount}`
);

console.log("\n=== PurrFluid Whitelist Proofs ===");
const proofKeys = [
  ...selectedUtxos.map(() => wallet1VK),
  orderValidatorScriptHash,
  ...(changeAmount > 0n ? [wallet1VK] : []),
];
const proofs = await fetchWhitelistProofs(proofKeys);
const whitelistUtxos = uniqueWhitelistUtxos(proofs);

type RefEntry = { txHash: string; outputIndex: number; label: string };
const sortedRefs: RefEntry[] = [
  ...whitelistUtxos.map((u) => ({
    txHash: u.input.txHash,
    outputIndex: u.input.outputIndex,
    label: "whitelistNode",
  })),
  {
    txHash: protocolParamsUtxo.input.txHash,
    outputIndex: protocolParamsUtxo.input.outputIndex,
    label: "protocolParams",
  },
  {
    txHash: registryNodeUtxo.input.txHash,
    outputIndex: registryNodeUtxo.input.outputIndex,
    label: "registryNode",
  },
].sort((a, b) => {
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
if (registryIndex < 0 || proofIndices.some((idx) => idx < 0)) {
  throw new Error("Failed to compute reference input indices");
}

const baseRedeemer = conStr0([]);
const globalRedeemer = conStr0([
  list([conStr0([integer(registryIndex)])]),
]);
const transferRedeemer = list(
  proofIndices.map((idx) => conStr(0, [integer(idx)]))
);

for (const selectedUtxo of selectedUtxos) {
  txBuilder
    .spendingPlutusScriptV3()
    .txIn(
      selectedUtxo.input.txHash,
      selectedUtxo.input.outputIndex,
      selectedUtxo.output.amount,
      selectedUtxo.output.address
    )
    .txInInlineDatumPresent()
    .txInScript(baseCbor)
    .txInRedeemerValue(baseRedeemer, "JSON");
}

for (const ref of sortedRefs) {
  txBuilder.readOnlyTxInReference(ref.txHash, ref.outputIndex);
}

txBuilder
  .txOut(orderValidatorAddress, [
    { unit: "lovelace", quantity: String(orderLovelaceAmount) },
    { unit: purrfluidUnit, quantity: String(swapAmount) },
  ])
  .txOutInlineDatumValue(orderDatum)
  .withdrawalPlutusScriptV3()
  .withdrawal(globalRewardAddr, "0")
  .withdrawalScript(globalCbor)
  .withdrawalRedeemerValue(globalRedeemer, "JSON")
  .withdrawalPlutusScriptV3()
  .withdrawal(transferLogicRewardAddr, "0")
  .withdrawalScript(transferLogicCbor)
  .withdrawalRedeemerValue(transferRedeemer, "JSON");

if (changeAmount > 0n) {
  txBuilder
    .txOut(wallet1SmartAddr, [
      { unit: "lovelace", quantity: "2000000" },
      { unit: purrfluidUnit, quantity: changeAmount.toString() },
    ])
    .txOutInlineDatumValue(conStr0([]), "JSON");
}

const unsignedTx = await txBuilder
  .txInCollateral(
    wallet1Collateral.input.txHash,
    wallet1Collateral.input.outputIndex,
    wallet1Collateral.output.amount,
    wallet1Collateral.output.address
  )
  .requiredSignerHash(wallet1VK)
  .changeAddress(wallet1Address)
  .selectUtxosFrom(wallet1Utxos)
  .complete();

const signedTx = await wallet1.signTx(unsignedTx);
const txHash = await wallet1.submitTx(signedTx);

console.log("Create sell order tx hash:", txHash);
