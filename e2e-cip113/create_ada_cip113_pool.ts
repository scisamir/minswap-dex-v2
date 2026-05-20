import {
  applyParamsToScript,
  byteString,
  conStr,
  conStr0,
  integer,
  list,
  deserializeDatum,
  mConStr0,
  mConStr1,
} from "@meshsdk/core";
import { SHA3 } from "sha3";
import {
  AdaAssetA,
  authenPolicyId,
  blockchainProvider,
  factoryAddress,
  factoryAssetName,
  factoryValidatorScript,
  AdaTokenSupply,
  maxInt64,
  poolAuthAssetName,
  poolBatchingValidatorHash,
  poolValidatorAddress,
  AdaRemainingLiquidity,
  AdaTotalLiquidity,
  txBuilder,
  wallet1,
  wallet1Address,
  wallet1Collateral,
  wallet1Utxos,
  wallet1VK,
  sTokenSupply,
} from "./setup.js";
import {
  BLACKLIST_MINT_HASH,
  TOKEN_ASSET_NAME,
  TOKEN_POLICY_ID,
  baseCbor,
  globalRewardAddr,
  getValidator,
  protocolParamsPolicyId,
  registrySpendAddr,
  blacklistSpendAddr,
  transferLogicCbor,
  transferLogicHash,
  transferLogicRewardAddr,
  validateConfig,
  wallet1SmartAddr,
} from "./programmableTokens/config.js";

validateConfig();

const sTokenUnit = TOKEN_POLICY_ID + TOKEN_ASSET_NAME;
const sTokenAssetB = mConStr0([TOKEN_POLICY_ID, TOKEN_ASSET_NAME]);
const sha3 = (hex: string): string => {
  const hash = new SHA3(256);
  hash.update(hex, "hex");
  return hash.digest("hex");
};
const adaAssetASha256 = sha3("");
const sTokenAssetBSha256 = sha3(sTokenUnit);
const sTokenAdaLpAssetName = sha3(adaAssetASha256 + sTokenAssetBSha256);

const authenScriptTxHash =
  "b8faf5ee39ec6015644ccf7a6e86a73603ed3816ca570a1554ac419f901f50d7";
const authenScriptTxIndex = 0;

const factoryUtxos = await blockchainProvider.fetchAddressUTxOs(factoryAddress);
const factoryInput = factoryUtxos[factoryUtxos.length - 1];
if (!factoryInput) {
  throw new Error("Factory input not found");
}

const factoryRedeemer = mConStr0([AdaAssetA, sTokenAssetB]);
const factoryNftUnit = authenPolicyId + factoryAssetName;
const factoryDatum1 = mConStr0(["00", sTokenAdaLpAssetName]);
const factoryDatum2 = mConStr0([
  sTokenAdaLpAssetName,
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00",
]);

const poolDatum = mConStr0([
  mConStr1([poolBatchingValidatorHash]),
  AdaAssetA,
  sTokenAssetB,
  AdaTotalLiquidity,
  AdaTokenSupply,
  sTokenSupply,
  6,
  6,
  mConStr1([]),
  mConStr0([]),
]);

console.log("AdaTotalLiquidity:", AdaTotalLiquidity);
console.log("AdaTokenSupply:", AdaTokenSupply);
console.log("sTokenSupply:", sTokenSupply);

const globalCbor = applyParamsToScript(
  getValidator("programmable_logic_global.programmable_logic_global.withdraw"),
  [byteString(protocolParamsPolicyId)],
  "JSON"
);

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
if (registryTransferHash && registryTransferHash !== transferLogicHash) {
  throw new Error(
    `Registry transfer hash ${registryTransferHash} does not match local transfer logic ${transferLogicHash}`
  );
}

const protocolParamsUnit =
  protocolParamsPolicyId + "50726f746f636f6c506172616d73";
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
const protocolParamsUtxo = protocolParamsAddressUtxos.find((u) =>
  u.output.amount.some((a) => a.unit === protocolParamsUnit)
);
if (!protocolParamsUtxo) {
  throw new Error("ProtocolParams UTxO not found");
}

console.log("\n=== Smart Wallet UTxOs ===");
const smartWalletUtxos =
  await blockchainProvider.fetchAddressUTxOs(wallet1SmartAddr);
const tokenUtxos = smartWalletUtxos.filter((utxo) =>
  utxo.output.amount.some((a) => a.unit === sTokenUnit)
);
if (!tokenUtxos.length) {
  throw new Error(`No sToken UTxOs found at ${wallet1SmartAddr}`);
}

const walletTokenBalance = tokenUtxos.reduce((sum, utxo) => {
  const qty = utxo.output.amount.find((a) => a.unit === sTokenUnit)?.quantity;
  return sum + BigInt(qty ?? "0");
}, 0n);
console.log("wallet sToken balance:", walletTokenBalance.toString());

const targetAmount = BigInt(sTokenSupply);
const selectedUtxos: typeof tokenUtxos = [];
let selectedBalance = 0n;
for (const utxo of tokenUtxos) {
  const qty = utxo.output.amount.find((a) => a.unit === sTokenUnit)?.quantity;
  if (!qty) continue;
  selectedUtxos.push(utxo);
  selectedBalance += BigInt(qty);
  if (selectedBalance >= targetAmount) break;
}

if (selectedBalance < targetAmount) {
  throw new Error(
    `Insufficient sToken balance. Have ${selectedBalance}, need ${targetAmount}`
  );
}

const changeAmount = selectedBalance - targetAmount;
console.log(
  `Selected ${selectedUtxos.length} UTxO(s), balance=${selectedBalance}, change=${changeAmount}`
);

console.log("\n=== Blacklist Proofs ===");
const blacklistUtxos =
  await blockchainProvider.fetchAddressUTxOs(blacklistSpendAddr);
if (!blacklistUtxos.length) {
  throw new Error(`No blacklist nodes found at ${blacklistSpendAddr}`);
}

type ProofEntry = {
  spendUtxo: (typeof selectedUtxos)[0];
  blacklistUtxo: (typeof blacklistUtxos)[0];
};

const proofs: ProofEntry[] = [];

for (const spendUtxo of selectedUtxos) {
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
      return key < wallet1VK && wallet1VK < next;
    } catch {
      return false;
    }
  });

  if (!coveringNode) {
    throw new Error(`No blacklist covering node for key hash: ${wallet1VK}`);
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

const txReadOnlyRefs: RefEntry[] = [
  ...uniqueBlacklistUtxos.map((u) => ({
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
];

const allReferenceInputs: RefEntry[] = [
  ...txReadOnlyRefs,
  {
    txHash: authenScriptTxHash,
    outputIndex: authenScriptTxIndex,
    label: "authenMintRef",
  },
].sort((a, b) => {
  const cmp = a.txHash.toLowerCase().localeCompare(b.txHash.toLowerCase());
  return cmp !== 0 ? cmp : a.outputIndex - b.outputIndex;
});

const registryIndex = allReferenceInputs.findIndex(
  (r) =>
    r.txHash === registryNodeUtxo.input.txHash &&
    r.outputIndex === registryNodeUtxo.input.outputIndex
);
if (registryIndex < 0) {
  throw new Error("Registry reference index not found");
}

const proofIndices = proofs.map((proof) =>
  allReferenceInputs.findIndex(
    (r) =>
      r.txHash === proof.blacklistUtxo.input.txHash &&
      r.outputIndex === proof.blacklistUtxo.input.outputIndex
  )
);
if (proofIndices.some((idx) => idx < 0)) {
  throw new Error("Blacklist proof reference index not found");
}

const globalRedeemer = conStr0([list([conStr0([integer(registryIndex)])])]);
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
    .txInScript(baseCbor)
    .txInInlineDatumPresent()
    .txInRedeemerValue(conStr0([]), "JSON");
}

for (const ref of txReadOnlyRefs) {
  txBuilder.readOnlyTxInReference(ref.txHash, ref.outputIndex);
}

const unsignedTx = await txBuilder
  .spendingPlutusScriptV3()
  .txIn(
    factoryInput.input.txHash,
    factoryInput.input.outputIndex,
    factoryInput.output.amount,
    factoryInput.output.address
  )
  .txInScript(factoryValidatorScript)
  .spendingReferenceTxInInlineDatumPresent()
  .spendingReferenceTxInRedeemerValue(factoryRedeemer)
  .withdrawalPlutusScriptV3()
  .withdrawal(globalRewardAddr, "0")
  .withdrawalScript(globalCbor)
  .withdrawalRedeemerValue(globalRedeemer, "JSON")
  .withdrawalPlutusScriptV3()
  .withdrawal(transferLogicRewardAddr, "0")
  .withdrawalScript(transferLogicCbor)
  .withdrawalRedeemerValue(transferRedeemer, "JSON")
  .mintPlutusScriptV3()
  .mint("1", authenPolicyId, factoryAssetName)
  .mintTxInReference(authenScriptTxHash, authenScriptTxIndex)
  .mintRedeemerValue(mConStr1([]))
  .mintPlutusScriptV3()
  .mint("1", authenPolicyId, poolAuthAssetName)
  .mintTxInReference(authenScriptTxHash, authenScriptTxIndex)
  .mintRedeemerValue(mConStr1([]))
  .mintPlutusScriptV3()
  .mint(String(maxInt64), authenPolicyId, sTokenAdaLpAssetName)
  .mintTxInReference(authenScriptTxHash, authenScriptTxIndex)
  .mintRedeemerValue(mConStr1([]))
  .txOut(factoryAddress, [{ unit: factoryNftUnit, quantity: "1" }])
  .txOutInlineDatumValue(factoryDatum1)
  .txOut(factoryAddress, [{ unit: factoryNftUnit, quantity: "1" }])
  .txOutInlineDatumValue(factoryDatum2)
  .txOut(poolValidatorAddress, [
    { unit: "lovelace", quantity: String(AdaTokenSupply + 4500000) },
    { unit: sTokenUnit, quantity: String(sTokenSupply) },
    {
      unit: authenPolicyId + sTokenAdaLpAssetName,
      quantity: String(AdaRemainingLiquidity),
    },
    { unit: authenPolicyId + poolAuthAssetName, quantity: "1" },
  ])
  .txOutInlineDatumValue(poolDatum);

if (changeAmount > 0n) {
  unsignedTx
    .txOut(wallet1SmartAddr, [
      { unit: "lovelace", quantity: "2000000" },
      { unit: sTokenUnit, quantity: changeAmount.toString() },
    ])
    .txOutInlineDatumValue(conStr0([]), "JSON");
}

unsignedTx
  .txInCollateral(
    wallet1Collateral.input.txHash,
    wallet1Collateral.input.outputIndex,
    wallet1Collateral.output.amount,
    wallet1Collateral.output.address
  )
  .requiredSignerHash(wallet1VK)
  .changeAddress(wallet1Address)
  .selectUtxosFrom(wallet1Utxos);

const completedTx = await unsignedTx.complete();
const signedTx = await wallet1.signTx(completedTx);
const txHash = await wallet1.submitTx(signedTx);

console.log("Create cip113 pool tx hash:", txHash);
