import { conStr, conStr0, integer, list, deserializeDatum, mConStr0, mConStr1, stringToHex, } from "@meshsdk/core";
import { AdaAssetA, authenPolicyId, blockchainProvider, factoryAddress, factoryAssetName, factoryValidatorScript, AdaTokenSupply, maxInt64, poolAuthAssetName, poolBatchingValidatorHash, poolValidatorAddress, poolValidatorScriptHash, AdaRemainingLiquidity, AdaTotalLiquidity, txBuilder, wallet1, wallet1Address, wallet1Collateral, wallet1Utxos, wallet1VK, purrfluidPoolSupply, } from "./setup.js";
import { TOKEN_POLICY_ID, baseCbor, globalCbor, globalRewardAddr, protocolParamsPolicyId, registrySpendAddr, transferLogicCbor, transferLogicHash, transferLogicRewardAddr, validateConfig, wallet1SmartAddr, } from "./purrfluid/config.js";
import { purrfluidAdaLpAssetName, purrfluidAssetB, purrfluidUnit, } from "./purrfluid/dexConfig.js";
import { fetchWhitelistProofs, uniqueWhitelistUtxos, } from "./purrfluid/whitelistProofs.js";
validateConfig();
const authenScriptTxHash = "d0932237cb0264454d516e50302fc2a4c2b2ab407f9d2e1c8fa2e3b221926dd9";
const authenScriptTxIndex = 0;
const factoryUtxos = await blockchainProvider.fetchAddressUTxOs(factoryAddress);
const factoryInput = factoryUtxos[factoryUtxos.length - 1];
if (!factoryInput) {
    throw new Error("Factory input not found");
}
const factoryRedeemer = mConStr0([AdaAssetA, purrfluidAssetB]);
const factoryNftUnit = authenPolicyId + factoryAssetName;
const factoryDatum1 = mConStr0(["00", purrfluidAdaLpAssetName]);
const factoryDatum2 = mConStr0([
    purrfluidAdaLpAssetName,
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00",
]);
const poolDatum = mConStr0([
    mConStr1([poolBatchingValidatorHash]),
    AdaAssetA,
    purrfluidAssetB,
    AdaTotalLiquidity,
    AdaTokenSupply,
    purrfluidPoolSupply,
    6,
    6,
    mConStr1([]),
    mConStr0([]),
]);
console.log("AdaTotalLiquidity:", AdaTotalLiquidity);
console.log("AdaTokenSupply:", AdaTokenSupply);
console.log("purrfluidPoolSupply:", purrfluidPoolSupply);
console.log("\n=== Registry ===");
const registryUtxos = await blockchainProvider.fetchAddressUTxOs(registrySpendAddr);
const registryNodes = [];
for (const utxo of registryUtxos) {
    if (!utxo.output.plutusData)
        continue;
    try {
        const datum = deserializeDatum(utxo.output.plutusData);
        registryNodes.push({
            utxo,
            key: datum?.fields?.[0]?.bytes ?? "",
            next: datum?.fields?.[1]?.bytes ?? "",
        });
    }
    catch {
        continue;
    }
}
const registryNodeUtxo = registryNodes.find((node) => node.key === TOKEN_POLICY_ID)?.utxo;
if (!registryNodeUtxo) {
    throw new Error(`Registry node not found for policy: ${TOKEN_POLICY_ID}`);
}
console.log(`Registry node: ${registryNodeUtxo.input.txHash}#${registryNodeUtxo.input.outputIndex}`);
const registryDatum = deserializeDatum(registryNodeUtxo.output.plutusData);
const registryTransferHash = registryDatum?.fields?.[2]?.fields?.[0]?.bytes ?? "";
if (registryTransferHash && registryTransferHash !== transferLogicHash) {
    throw new Error(`Registry transfer hash ${registryTransferHash} does not match local transfer logic ${transferLogicHash}`);
}
const protocolParamsUnit = protocolParamsPolicyId + stringToHex("ProtocolParams");
const protocolParamsAddresses = await blockchainProvider.fetchAssetAddresses(protocolParamsUnit);
if (!protocolParamsAddresses.length) {
    throw new Error(`ProtocolParams asset not found on chain. Unit: ${protocolParamsUnit}`);
}
const protocolParamsAddressUtxos = await blockchainProvider.fetchAddressUTxOs(protocolParamsAddresses[0].address);
const protocolParamsUtxo = protocolParamsAddressUtxos.find((u) => u.output.amount.some((a) => a.unit === protocolParamsUnit));
if (!protocolParamsUtxo) {
    throw new Error("ProtocolParams UTxO not found");
}
console.log("\n=== Smart Wallet UTxOs ===");
const smartWalletUtxos = await blockchainProvider.fetchAddressUTxOs(wallet1SmartAddr);
const tokenUtxos = smartWalletUtxos.filter((utxo) => utxo.output.amount.some((a) => a.unit === purrfluidUnit));
if (!tokenUtxos.length) {
    throw new Error(`No PurrFluid UTxOs found at ${wallet1SmartAddr}`);
}
const walletTokenBalance = tokenUtxos.reduce((sum, utxo) => {
    const qty = utxo.output.amount.find((a) => a.unit === purrfluidUnit)?.quantity;
    return sum + BigInt(qty ?? "0");
}, 0n);
console.log("wallet PurrFluid balance:", walletTokenBalance.toString());
const targetAmount = BigInt(purrfluidPoolSupply);
const selectedUtxos = [];
let selectedBalance = 0n;
for (const utxo of tokenUtxos) {
    const qty = utxo.output.amount.find((a) => a.unit === purrfluidUnit)?.quantity;
    if (!qty)
        continue;
    selectedUtxos.push(utxo);
    selectedBalance += BigInt(qty);
    if (selectedBalance >= targetAmount)
        break;
}
if (selectedBalance < targetAmount) {
    throw new Error(`Insufficient PurrFluid balance. Have ${selectedBalance}, need ${targetAmount}`);
}
const changeAmount = selectedBalance - targetAmount;
selectedUtxos.sort((a, b) => {
    const cmp = a.input.txHash
        .toLowerCase()
        .localeCompare(b.input.txHash.toLowerCase());
    return cmp !== 0 ? cmp : a.input.outputIndex - b.input.outputIndex;
});
console.log(`Selected ${selectedUtxos.length} UTxO(s), balance=${selectedBalance}, change=${changeAmount}`);
const selectedInputPolicyIds = selectedUtxos.flatMap((utxo) => utxo.output.amount
    .filter((asset) => asset.unit !== "lovelace")
    .map((asset) => asset.unit.slice(0, 56)));
const globalPolicyIds = [
    ...new Set([authenPolicyId, ...selectedInputPolicyIds]),
].sort();
const globalRegistryProofs = globalPolicyIds.map((policyId) => {
    const existing = registryNodes.find((node) => node.key === policyId);
    if (existing) {
        return { policyId, kind: "exists", utxo: existing.utxo };
    }
    const covering = registryNodes.find((node) => node.key < policyId && policyId < node.next);
    if (!covering) {
        throw new Error(`No registry proof node found for policy: ${policyId}`);
    }
    return { policyId, kind: "doesNotExist", utxo: covering.utxo };
});
console.log("\n=== Global Registry Proofs ===");
for (const proof of globalRegistryProofs) {
    console.log(`${proof.kind}: ${proof.policyId} via ${proof.utxo.input.txHash}#${proof.utxo.input.outputIndex}`);
}
console.log("\n=== PurrFluid Whitelist Proofs ===");
const proofKeys = [
    ...selectedUtxos.map(() => wallet1VK),
    poolValidatorScriptHash,
    ...(changeAmount > 0n ? [wallet1VK] : []),
];
const proofs = await fetchWhitelistProofs(proofKeys);
const whitelistUtxos = uniqueWhitelistUtxos(proofs);
const registryProofUtxos = [];
for (const proof of globalRegistryProofs) {
    const alreadyIncluded = registryProofUtxos.some((utxo) => utxo.input.txHash === proof.utxo.input.txHash &&
        utxo.input.outputIndex === proof.utxo.input.outputIndex);
    if (!alreadyIncluded) {
        registryProofUtxos.push(proof.utxo);
    }
}
const txReadOnlyRefs = [
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
    ...registryProofUtxos.map((utxo) => ({
        txHash: utxo.input.txHash,
        outputIndex: utxo.input.outputIndex,
        label: "registryNode",
    })),
];
const allReferenceInputs = [
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
const globalProofRedeemers = globalRegistryProofs.map((proof) => {
    const registryIndex = allReferenceInputs.findIndex((r) => r.txHash === proof.utxo.input.txHash &&
        r.outputIndex === proof.utxo.input.outputIndex);
    if (registryIndex < 0) {
        throw new Error(`Registry reference index not found: ${proof.policyId}`);
    }
    return proof.kind === "exists"
        ? conStr0([integer(registryIndex)])
        : conStr(1, [integer(registryIndex)]);
});
const proofIndices = proofs.map((proof) => allReferenceInputs.findIndex((r) => r.txHash === proof.utxo.input.txHash &&
    r.outputIndex === proof.utxo.input.outputIndex));
if (proofIndices.some((idx) => idx < 0)) {
    throw new Error("PurrFluid whitelist proof reference index not found");
}
const globalRedeemer = conStr0([list(globalProofRedeemers)]);
const transferRedeemer = list(proofIndices.map((idx) => conStr(0, [integer(idx)])));
for (const selectedUtxo of selectedUtxos) {
    txBuilder
        .spendingPlutusScriptV3()
        .txIn(selectedUtxo.input.txHash, selectedUtxo.input.outputIndex, selectedUtxo.output.amount, selectedUtxo.output.address)
        .txInScript(baseCbor)
        .txInInlineDatumPresent()
        .txInRedeemerValue(conStr0([]), "JSON");
}
for (const ref of txReadOnlyRefs) {
    txBuilder.readOnlyTxInReference(ref.txHash, ref.outputIndex);
}
const unsignedTx = await txBuilder
    .spendingPlutusScriptV3()
    .txIn(factoryInput.input.txHash, factoryInput.input.outputIndex, factoryInput.output.amount, factoryInput.output.address)
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
    .mint(String(maxInt64), authenPolicyId, purrfluidAdaLpAssetName)
    .mintTxInReference(authenScriptTxHash, authenScriptTxIndex)
    .mintRedeemerValue(mConStr1([]))
    .txOut(factoryAddress, [{ unit: factoryNftUnit, quantity: "1" }])
    .txOutInlineDatumValue(factoryDatum1)
    .txOut(factoryAddress, [{ unit: factoryNftUnit, quantity: "1" }])
    .txOutInlineDatumValue(factoryDatum2)
    .txOut(poolValidatorAddress, [
    { unit: "lovelace", quantity: String(AdaTokenSupply + 4500000) },
    { unit: purrfluidUnit, quantity: String(purrfluidPoolSupply) },
    {
        unit: authenPolicyId + purrfluidAdaLpAssetName,
        quantity: String(AdaRemainingLiquidity),
    },
    { unit: authenPolicyId + poolAuthAssetName, quantity: "1" },
])
    .txOutInlineDatumValue(poolDatum);
if (changeAmount > 0n) {
    unsignedTx
        .txOut(wallet1SmartAddr, [
        { unit: "lovelace", quantity: "2000000" },
        { unit: purrfluidUnit, quantity: changeAmount.toString() },
    ])
        .txOutInlineDatumValue(conStr0([]), "JSON");
}
unsignedTx
    .txInCollateral(wallet1Collateral.input.txHash, wallet1Collateral.input.outputIndex, wallet1Collateral.output.amount, wallet1Collateral.output.address)
    .requiredSignerHash(wallet1VK)
    .changeAddress(wallet1Address)
    .selectUtxosFrom(wallet1Utxos);
const completedTx = await unsignedTx.complete();
const signedTx = await wallet1.signTx(completedTx);
const txHash = await wallet1.submitTx(signedTx);
console.log("Create cip113 pool tx hash:", txHash);
