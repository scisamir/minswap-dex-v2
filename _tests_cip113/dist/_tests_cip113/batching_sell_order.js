import { deserializeDatum, mConStr0, mConStr1, SLOT_CONFIG_NETWORK, unixTimeToEnclosingSlot, } from "@meshsdk/core";
import { cip113ValidatorScript, AdaAssetA, authenAddress, authenPolicyId, blockchainProvider, orderLovelaceAmount, orderValidatorAddress, orderValidatorRewardAddress, orderValidatorScriptHash, poolAuthAssetName, poolBatchingValidatorHash, poolBatchingValidatorRewardAddress, poolValidatorAddress, poolValidatorRewardAddress, poolValidatorScriptHash, AdaRemainingLiquidity, AdaTotalLiquidity, txBuilder, wallet1, wallet1Address, wallet1Collateral, wallet1Utxos, wallet1VK, cip113RewardAddress, userCip113Addr, usdcAssetB, usdcAdaLpAssetName, usdcUnit, orderScriptTxHash, orderScriptTxIndex, poolScriptTxHash, poolScriptTxIndex, poolBatchingScriptTxHash, poolBatchingScriptTxIndex, calculate_amount_out, } from "./setup.js";
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
const usedBatcherFee = 2800000; // -> changes here
const poolBatchingRedeemer = mConStr0([
    0,
    [usedBatcherFee], // used_batcher_fee, first index: 3 ADA
    "00", // minswap used "00"
    mConStr1([]),
    [mConStr1([])], // [mConStr0([6])],
]);
// order output value
const orderLovelaceBalance = orderLovelaceAmount - usedBatcherFee;
console.log("orderLovelaceBalance", orderLovelaceBalance);
const orderPlutusData = orderUtxo.output.plutusData;
if (!orderPlutusData)
    throw new Error("Invalid order");
const orderDatum = deserializeDatum(orderPlutusData);
const swapAmount = Number(orderDatum.fields[6].fields[1].fields[0].int);
// updated pool datum (calculated updated reserves based on A -> B order direction)
if (!poolUtxo.output.plutusData) {
    throw new Error("No datum in pool utxo");
}
const oldPoolDatum = deserializeDatum(poolUtxo.output.plutusData); // ideal way is to create a type for the datum to deserialize; this is just for testing
const oldPoolAdaTokenSupply = Number(oldPoolDatum.fields[4].int);
const oldPoolUsdcSupply = Number(oldPoolDatum.fields[5].int);
const base_fee_a_numerator = 6;
const adaSellOrderAmount = calculate_amount_out(oldPoolUsdcSupply, oldPoolAdaTokenSupply, swapAmount, base_fee_a_numerator);
console.log("swapAmount:", swapAmount);
console.log("adaSellOrderAmount:", adaSellOrderAmount);
const updatedAdaTokenSupply = oldPoolAdaTokenSupply - adaSellOrderAmount;
const updatedUsdcSupply = oldPoolUsdcSupply + swapAmount;
console.log("updatedAdaTokenSupply:", updatedAdaTokenSupply);
console.log("updatedUsdcSupply:", updatedUsdcSupply);
const poolDatum = mConStr0([
    mConStr1([poolBatchingValidatorHash]),
    AdaAssetA,
    usdcAssetB,
    AdaTotalLiquidity,
    updatedAdaTokenSupply,
    updatedUsdcSupply,
    6,
    6,
    mConStr1([]),
    mConStr0([]),
]);
const invalidBefore = unixTimeToEnclosingSlot(Date.now() - 45000, SLOT_CONFIG_NETWORK.mainnet);
const invalidAfter = unixTimeToEnclosingSlot(Date.now() + 8 * 60 * 1000, // 8 mins
SLOT_CONFIG_NETWORK.mainnet);
const rMem = 1500000;
const rSteps = 1000000000;
const unsignedTx = await txBuilder
    // spend order utxo (spend cip 113)
    .spendingPlutusScriptV3()
    .txIn(orderUtxo.input.txHash, orderUtxo.input.outputIndex, orderUtxo.output.amount, orderUtxo.output.address)
    .txInScript(cip113ValidatorScript)
    .spendingReferenceTxInInlineDatumPresent()
    .spendingReferenceTxInRedeemerValue("")
    // .spendingReferenceTxInRedeemerValue("", "Mesh", { mem: rMem, steps: rSteps })
    // spend pool utxo (spend cip 113)
    .spendingPlutusScriptV3()
    .txIn(poolUtxo.input.txHash, poolUtxo.input.outputIndex, poolUtxo.output.amount, poolUtxo.output.address)
    .txInScript(cip113ValidatorScript)
    .spendingReferenceTxInInlineDatumPresent()
    .spendingReferenceTxInRedeemerValue("")
    // .spendingReferenceTxInRedeemerValue("",  "Mesh", { mem: rMem, steps: rSteps })
    // withdraw cip113
    .withdrawalPlutusScriptV3()
    .withdrawal(cip113RewardAddress, "0")
    .withdrawalScript(cip113ValidatorScript)
    .withdrawalRedeemerValue("")
    // .withdrawalRedeemerValue("", "Mesh", { mem: rMem, steps: rSteps })
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
    // .withdrawalRedeemerValue(poolBatchingRedeemer)
    // .withdrawalRedeemerValue(poolBatchingRedeemer, "Mesh", { mem: rMem, steps: rSteps })
    // order output
    .txOut(userCip113Addr, [
    {
        unit: "lovelace",
        quantity: String(orderLovelaceBalance + adaSellOrderAmount),
    },
])
    // pool validator output
    .txOut(poolValidatorAddress, [
    { unit: "lovelace", quantity: String(updatedAdaTokenSupply + 4500000) },
    { unit: usdcUnit, quantity: String(updatedUsdcSupply) },
    {
        unit: authenPolicyId + usdcAdaLpAssetName,
        quantity: String(AdaRemainingLiquidity),
    },
    { unit: authenPolicyId + poolAuthAssetName, quantity: "1" },
])
    .txOutInlineDatumValue(poolDatum)
    // global settings utxo ref
    .readOnlyTxInReference(globalSettingsUtxo.input.txHash, globalSettingsUtxo.input.outputIndex)
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
