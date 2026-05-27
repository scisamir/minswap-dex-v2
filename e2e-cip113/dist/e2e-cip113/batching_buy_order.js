import { conStr, conStr0, deserializeDatum, deserializeAddress, integer, list, mConStr0, mConStr1, serializeAddressObj, SLOT_CONFIG_NETWORK, stringToHex, unixTimeToEnclosingSlot, } from "@meshsdk/core";
import { AdaAssetA, authenAddress, authenPolicyId, baseScript, blockchainProvider, orderValidatorAddress, orderValidatorRewardAddress, orderValidatorScriptHash, poolAuthAssetName, poolBatchingValidatorHash, poolBatchingValidatorRewardAddress, poolValidatorAddress, poolValidatorRewardAddress, poolValidatorScriptHash, AdaRemainingLiquidity, AdaTotalLiquidity, txBuilder, wallet1, wallet1Address, wallet1Collateral, wallet1Utxos, wallet1VK, NETWORK_ID, orderScriptTxHash, orderScriptTxIndex, poolScriptTxHash, poolScriptTxIndex, poolBatchingScriptTxHash, poolBatchingScriptTxIndex, calculate_amount_out, } from "./setup.js";
import { TOKEN_POLICY_ID, globalCbor, globalRewardAddr, protocolParamsPolicyId, registrySpendAddr, transferLogicCbor, transferLogicHash, transferLogicRewardAddr, validateConfig, } from "./purrfluid/config.js";
import { purrfluidAdaLpAssetName, purrfluidAssetB, purrfluidUnit, } from "./purrfluid/dexConfig.js";
import { fetchWhitelistProofs, uniqueWhitelistUtxos, } from "./purrfluid/whitelistProofs.js";
validateConfig();
console.log("pool validator utxos number:", (await blockchainProvider.fetchAddressUTxOs(poolValidatorAddress)).length, "\n");
console.log("order validator utxos number:", (await blockchainProvider.fetchAddressUTxOs(orderValidatorAddress)).length, "\n");
const poolUtxo = (await blockchainProvider.fetchAddressUTxOs(poolValidatorAddress))[0];
if (!poolUtxo) {
    throw new Error("pool utxo not found!");
}
const orderUtxos = await blockchainProvider.fetchAddressUTxOs(orderValidatorAddress);
const orderUtxo = orderUtxos[orderUtxos.length - 1];
if (!orderUtxo) {
    throw new Error("order utxo not found!");
}
const globalSettingsUtxo = (await blockchainProvider.fetchAddressUTxOs(authenAddress))[0];
if (!globalSettingsUtxo) {
    throw new Error("global settings utxo not found!");
}
const orderPlutusData = orderUtxo.output.plutusData;
if (!orderPlutusData)
    throw new Error("Invalid order");
const orderDatum = deserializeDatum(orderPlutusData);
console.log("\n");
console.log("Order Utxo:", orderUtxo);
const isBuyOrder = Number(orderDatum.fields[6].fields[0].constructor) === 1 ? true : false;
if (!isBuyOrder)
    throw new Error("Not a buy order!");
const orderSwapAmount = Number(orderDatum.fields[6].fields[1].fields[0].int);
const orderReceiverAddr = serializeAddressObj(orderDatum.fields[3], NETWORK_ID);
const orderUtxoBalance = Number(orderUtxo.output.amount[0].quantity);
console.log("orderSwapAmount:", orderSwapAmount);
console.log("orderReceiverAddr:", orderReceiverAddr, "\n");
console.log("=== Registry ===");
const registryUtxos = await blockchainProvider.fetchAddressUTxOs(registrySpendAddr);
let registryNodeUtxo = null;
for (const utxo of registryUtxos) {
    if (!utxo.output.plutusData)
        continue;
    try {
        const datum = deserializeDatum(utxo.output.plutusData);
        if ((datum?.fields?.[0]?.bytes ?? "") === TOKEN_POLICY_ID) {
            registryNodeUtxo = utxo;
            break;
        }
    }
    catch {
        continue;
    }
}
if (!registryNodeUtxo) {
    throw new Error(`Registry node not found for policy: ${TOKEN_POLICY_ID}`);
}
const registryDatum = deserializeDatum(registryNodeUtxo.output.plutusData);
const registryTransferHash = registryDatum?.fields?.[2]?.fields?.[0]?.bytes ?? "";
console.log("Registry transfer hash:", registryTransferHash);
console.log("Local transfer hash:   ", transferLogicHash);
if (registryTransferHash && registryTransferHash !== transferLogicHash) {
    throw new Error(`Config mismatch: registry transfer hash is ${registryTransferHash}, local transferLogicHash is ${transferLogicHash}`);
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
console.log("\n=== PurrFluid Whitelist Proofs ===");
const programmableInputs = [orderUtxo, poolUtxo].filter((utxo) => utxo.output.amount.some((asset) => asset.unit === purrfluidUnit)).sort((a, b) => {
    const cmp = a.input.txHash
        .toLowerCase()
        .localeCompare(b.input.txHash.toLowerCase());
    return cmp !== 0 ? cmp : a.input.outputIndex - b.input.outputIndex;
});
const programmablePolicies = [];
for (const utxo of programmableInputs) {
    for (const asset of utxo.output.amount) {
        if (asset.unit === "lovelace")
            continue;
        const policyId = asset.unit.slice(0, 56);
        if (!programmablePolicies.includes(policyId)) {
            programmablePolicies.push(policyId);
        }
    }
}
programmablePolicies.sort((a, b) => a.localeCompare(b));
const deriveWitnessKey = (address) => {
    if (address === orderValidatorAddress)
        return orderValidatorScriptHash;
    if (address === poolValidatorAddress)
        return poolValidatorScriptHash;
    const parsed = deserializeAddress(address);
    return (parsed.stakeScriptCredentialHash ||
        parsed.stakeCredentialHash ||
        parsed.pubKeyHash ||
        parsed.scriptHash);
};
const inputProofKeys = programmableInputs.map((utxo) => {
    const witnessKey = deriveWitnessKey(utxo.output.address);
    if (!witnessKey) {
        throw new Error(`Could not derive sender proof key hash from ${utxo.input.txHash}#${utxo.input.outputIndex}`);
    }
    return witnessKey;
});
const outputProofKeys = [
    deriveWitnessKey(orderReceiverAddr),
    poolValidatorScriptHash,
];
if (outputProofKeys.some((key) => !key)) {
    throw new Error("Could not derive PurrFluid output whitelist credential");
}
const proofs = await fetchWhitelistProofs([
    ...inputProofKeys,
    ...outputProofKeys,
]);
const whitelistNodes = uniqueWhitelistUtxos(proofs);
const programmableRefs = [
    ...whitelistNodes.map((utxo) => ({
        txHash: utxo.input.txHash,
        outputIndex: utxo.input.outputIndex,
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
];
const globalPolicyProofEntries = programmablePolicies.map((policyId) => {
    const exactNode = registryUtxos.find((utxo) => {
        if (!utxo.output.plutusData)
            return false;
        try {
            const datum = deserializeDatum(utxo.output.plutusData);
            return (datum?.fields?.[0]?.bytes ?? "") === policyId;
        }
        catch {
            return false;
        }
    });
    if (exactNode) {
        return {
            policyId,
            txHash: exactNode.input.txHash,
            outputIndex: exactNode.input.outputIndex,
            label: policyId === TOKEN_POLICY_ID ? "registryNode" : "registryExactNode",
            proofConstructor: 0,
        };
    }
    const coveringNode = registryUtxos.find((utxo) => {
        if (!utxo.output.plutusData)
            return false;
        try {
            const datum = deserializeDatum(utxo.output.plutusData);
            const key = datum?.fields?.[0]?.bytes ?? "";
            const next = datum?.fields?.[1]?.bytes ?? "";
            return key < policyId && policyId < next;
        }
        catch {
            return false;
        }
    });
    if (!coveringNode) {
        throw new Error(`No covering registry node for policy: ${policyId}`);
    }
    return {
        policyId,
        txHash: coveringNode.input.txHash,
        outputIndex: coveringNode.input.outputIndex,
        label: "registryCoveringNode",
        proofConstructor: 1,
    };
});
const txReadOnlyRefs = [
    {
        txHash: globalSettingsUtxo.input.txHash,
        outputIndex: globalSettingsUtxo.input.outputIndex,
        label: "globalSettings",
    },
    ...programmableRefs,
    ...globalPolicyProofEntries
        .filter((entry) => !programmableRefs.some((ref) => ref.txHash === entry.txHash && ref.outputIndex === entry.outputIndex))
        .map((entry) => ({
        txHash: entry.txHash,
        outputIndex: entry.outputIndex,
        label: entry.label,
    })),
];
const allRefInputs = [
    {
        txHash: orderScriptTxHash,
        outputIndex: orderScriptTxIndex,
        label: "orderRefScript",
    },
    {
        txHash: poolBatchingScriptTxHash,
        outputIndex: poolBatchingScriptTxIndex,
        label: "poolBatchingRefScript",
    },
    {
        txHash: poolScriptTxHash,
        outputIndex: poolScriptTxIndex,
        label: "poolRefScript",
    },
    ...txReadOnlyRefs,
];
const sortedRefInputs = [...allRefInputs]
    .sort((a, b) => {
    const cmp = a.txHash.toLowerCase().localeCompare(b.txHash.toLowerCase());
    return cmp !== 0 ? cmp : a.outputIndex - b.outputIndex;
})
    .filter((ref, index, refs) => refs.findIndex((candidate) => candidate.txHash === ref.txHash &&
    candidate.outputIndex === ref.outputIndex) === index);
const registryIndex = sortedRefInputs.findIndex((r) => r.txHash === registryNodeUtxo.input.txHash &&
    r.outputIndex === registryNodeUtxo.input.outputIndex);
const globalProofIndices = globalPolicyProofEntries.map((entry) => sortedRefInputs.findIndex((r) => r.txHash === entry.txHash && r.outputIndex === entry.outputIndex));
const proofIndices = proofs.map((proof) => sortedRefInputs.findIndex((r) => r.txHash === proof.utxo.input.txHash &&
    r.outputIndex === proof.utxo.input.outputIndex));
if (registryIndex < 0 ||
    globalProofIndices.some((idx) => idx < 0) ||
    proofIndices.some((idx) => idx < 0)) {
    throw new Error("Failed to compute reference input indices");
}
console.log("ref input order:", sortedRefInputs.map((ref, idx) => `${idx}:${ref.label}:${ref.txHash}#${ref.outputIndex}`));
console.log("registryIndex:", registryIndex);
console.log("globalProofIndices:", globalProofIndices);
console.log("proofIndices:", proofIndices);
const baseRedeemer = conStr0([]);
const globalRedeemer = conStr0([
    list(globalPolicyProofEntries.map((entry, i) => conStr(entry.proofConstructor, [integer(globalProofIndices[i])]))),
]);
const transferRedeemer = list(proofIndices.map((idx) => conStr(0, [integer(idx)])));
const usedBatcherFee = 2800000; // -> changes here
const orderBalance = orderUtxoBalance - orderSwapAmount - usedBatcherFee;
const poolBatchingRedeemer = mConStr0([
    0, // batcher index
    [usedBatcherFee], // used_batcher_fee, first index: 3 ADA
    "00", // minswap used "00"
    mConStr1([]),
    [mConStr1([])], // [mConStr0([6])],
]);
if (!poolUtxo.output.plutusData) {
    throw new Error("No datum in pool utxo");
}
const oldPoolDatum = deserializeDatum(poolUtxo.output.plutusData); // ideal way is to create a type for the datum to deserialize; this is just for testing
const oldPoolAdaTokenSupply = Number(oldPoolDatum.fields[4].int);
const oldPoolSTokenSupply = Number(oldPoolDatum.fields[5].int);
const base_fee_a_numerator = 6;
const assetBAmount = calculate_amount_out(oldPoolAdaTokenSupply, oldPoolSTokenSupply, orderSwapAmount, base_fee_a_numerator);
console.log("assetBAmount:", assetBAmount);
// updated pool datum (calculated updated reserves based on A -> B order direction)
const updatedAdaTokenSupply = oldPoolAdaTokenSupply + orderSwapAmount;
const updatedSTokenSupply = oldPoolSTokenSupply - assetBAmount;
console.log("updatedAdaTokenSupply:", updatedAdaTokenSupply);
console.log("updatedSTokenSupply:", updatedSTokenSupply);
const poolDatum = mConStr0([
    mConStr1([poolBatchingValidatorHash]),
    AdaAssetA,
    purrfluidAssetB,
    AdaTotalLiquidity,
    updatedAdaTokenSupply,
    updatedSTokenSupply,
    base_fee_a_numerator,
    6,
    mConStr1([]),
    mConStr0([]),
]);
console.log("oldPoolAdaTokenSupply:", oldPoolAdaTokenSupply);
console.log("oldPoolSTokenSupply:", oldPoolSTokenSupply);
console.log("orderBalance:", orderBalance);
const invalidBefore = unixTimeToEnclosingSlot(Date.now() - 45000, SLOT_CONFIG_NETWORK.preview);
const invalidAfter = unixTimeToEnclosingSlot(Date.now() + 8 * 60 * 1000, // 8 mins
SLOT_CONFIG_NETWORK.preview);
const rMem = 1500000;
const rSteps = 1000000000;
for (const ref of sortedRefInputs) {
    txBuilder.readOnlyTxInReference(ref.txHash, ref.outputIndex);
}
const unsignedTx = await txBuilder
    // spend order utxo via programmable base
    .spendingPlutusScriptV3()
    .txIn(orderUtxo.input.txHash, orderUtxo.input.outputIndex, orderUtxo.output.amount, orderUtxo.output.address)
    .txInScript(baseScript)
    .txInInlineDatumPresent()
    .txInRedeemerValue(baseRedeemer, "JSON")
    // spend pool utxo via programmable base
    .spendingPlutusScriptV3()
    .txIn(poolUtxo.input.txHash, poolUtxo.input.outputIndex, poolUtxo.output.amount, poolUtxo.output.address)
    .txInScript(baseScript)
    .txInInlineDatumPresent()
    .txInRedeemerValue(baseRedeemer, "JSON")
    // programmable global withdrawal
    .withdrawalPlutusScriptV3()
    .withdrawal(globalRewardAddr, "0")
    .withdrawalScript(globalCbor)
    .withdrawalRedeemerValue(globalRedeemer, "JSON")
    // transfer logic withdrawal
    .withdrawalPlutusScriptV3()
    .withdrawal(transferLogicRewardAddr, "0")
    .withdrawalScript(transferLogicCbor)
    .withdrawalRedeemerValue(transferRedeemer, "JSON")
    // withdraw script on order utxo
    .withdrawalPlutusScriptV3()
    .withdrawal(orderValidatorRewardAddress, "0")
    .withdrawalTxInReference(orderScriptTxHash, orderScriptTxIndex, undefined, orderValidatorScriptHash)
    .withdrawalRedeemerValue(mConStr0([]))
    // .withdrawalRedeemerValue(mConStr0([]), "Mesh", { mem: rMem, steps: rSteps })
    // withdraw script on pool utxo
    .withdrawalPlutusScriptV3()
    .withdrawal(poolValidatorRewardAddress, "0")
    .withdrawalTxInReference(poolScriptTxHash, poolScriptTxIndex, undefined, poolValidatorScriptHash)
    .withdrawalRedeemerValue(mConStr0([]))
    // .withdrawalRedeemerValue(mConStr0([]), "Mesh", { mem: rMem, steps: rSteps })
    // pool batching withdrawal
    .withdrawalPlutusScriptV3()
    .withdrawal(poolBatchingValidatorRewardAddress, "0")
    .withdrawalTxInReference(poolBatchingScriptTxHash, poolBatchingScriptTxIndex, undefined, poolBatchingValidatorHash)
    .withdrawalRedeemerValue(poolBatchingRedeemer)
    // order output
    .txOut(orderReceiverAddr, [
    { unit: "lovelace", quantity: String(orderBalance) },
    { unit: purrfluidUnit, quantity: String(assetBAmount) },
])
    // pool validator output
    .txOut(poolValidatorAddress, [
    { unit: "lovelace", quantity: String(updatedAdaTokenSupply + 4500000) },
    { unit: purrfluidUnit, quantity: String(updatedSTokenSupply) },
    {
        unit: authenPolicyId + purrfluidAdaLpAssetName,
        quantity: String(AdaRemainingLiquidity),
    },
    { unit: authenPolicyId + poolAuthAssetName, quantity: "1" },
])
    .txOutInlineDatumValue(poolDatum)
    .txInCollateral(wallet1Collateral.input.txHash, wallet1Collateral.input.outputIndex, wallet1Collateral.output.amount, wallet1Collateral.output.address)
    .invalidBefore(invalidBefore)
    .invalidHereafter(invalidAfter)
    // transaction must be executed by authorized batcher, wallet1VK
    .requiredSignerHash(wallet1VK)
    .changeAddress(wallet1Address)
    .selectUtxosFrom(wallet1Utxos)
    //   .setFee("4108405")
    .complete();
const signedTx = await wallet1.signTx(unsignedTx);
const txHash = await wallet1.submitTx(signedTx);
console.log("pool batching tx hash:", txHash);
