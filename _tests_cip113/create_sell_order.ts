import {
  applyParamsToScript,
  byteString,
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
  txBuilder,
  wallet1,
  wallet1Address,
  wallet1Collateral,
  wallet1Utxos,
  wallet1VK,
  baseHash,
  swapAmount,
  sTokenUnit,
  sTokenAdaLpAssetName,
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
  getValidator,
  validateConfig,
  wallet1SmartAddr,
  baseCbor,
} from "./programmableTokens/config.js";

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
    sTokenAdaLpAssetName,
  ]),
  orderStep,
  6000000,
  mConStr1([]),
]);

const globalCbor = applyParamsToScript(
  getValidator("programmable_logic_global.programmable_logic_global.withdraw"),
  [byteString(protocolParamsPolicyId)],
  "JSON"
);

console.log("=== Create Sell Order ===");
console.log("sTokenAdaLpAssetName:", sTokenAdaLpAssetName);

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
  const qty = utxo.output.amount.find((a: { unit: string; quantity: string }) => a.unit === sTokenUnit)?.quantity;
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
console.log(
  `Selected ${selectedUtxos.length} UTxO(s), balance=${selectedBalance}, change=${changeAmount}`
);

console.log("\n=== Blacklist Proofs ===");
const blacklistUtxos =
  await blockchainProvider.fetchAddressUTxOs(blacklistSpendAddr);
const senderProofKeyHash = wallet1VK;

type ProofEntry = {
  spendUtxo: (typeof selectedUtxos)[0];
  blacklistUtxo: (typeof blacklistUtxos)[0];
};

const proofs: ProofEntry[] = [];

for (const spendUtxo of selectedUtxos) {
  const coveringNode = blacklistUtxos.find((blUtxo: (typeof blacklistUtxos)[number]) => {
    if (!blUtxo.output.plutusData) return false;
    try {
      const hasBlacklistPolicy = blUtxo.output.amount.some(
        (a: { unit: string }) =>
          a.unit !== "lovelace" && a.unit.startsWith(BLACKLIST_MINT_HASH)
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
    throw new Error(`No blacklist covering node for key hash: ${senderProofKeyHash}`);
  }

  proofs.push({ spendUtxo, blacklistUtxo: coveringNode });
}

const uniqueBlacklistUtxos: typeof blacklistUtxos = [];
const seen = new Set<string>();
for (const proof of proofs) {
  const key = `${proof.blacklistUtxo.input.txHash}#${proof.blacklistUtxo.input.outputIndex}`;
  if (!seen.has(key)) {
    seen.add(key);
    uniqueBlacklistUtxos.push(proof.blacklistUtxo);
  }
}

type RefEntry = { txHash: string; outputIndex: number; label: string };
const sortedRefs: RefEntry[] = [
  ...uniqueBlacklistUtxos.map((u: (typeof uniqueBlacklistUtxos)[number]) => ({
    txHash: u.input.txHash,
    outputIndex: u.input.outputIndex,
    label: "blacklistNode",
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
      r.txHash === proof.blacklistUtxo.input.txHash &&
      r.outputIndex === proof.blacklistUtxo.input.outputIndex
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
    { unit: sTokenUnit, quantity: String(swapAmount) },
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
      { unit: sTokenUnit, quantity: changeAmount.toString() },
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
