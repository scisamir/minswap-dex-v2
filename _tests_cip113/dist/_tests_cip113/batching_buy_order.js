import { deserializeDatum, mConStr0, mConStr1, SLOT_CONFIG_NETWORK, unixTimeToEnclosingSlot } from "@meshsdk/core";
import { cip113ValidatorScript, AdaAssetA, authenAddress, authenPolicyId, blockchainProvider, orderLovelaceAmount, orderValidatorAddress, orderValidatorRewardAddress, orderValidatorScriptHash, poolAuthAssetName, poolBatchingValidatorHash, poolBatchingValidatorRewardAddress, poolValidatorAddress, poolValidatorRewardAddress, poolValidatorScriptHash, AdaRemainingLiquidity, AdaSwapAmount, AdaTotalLiquidity, txBuilder, wallet1, wallet1Address, wallet1Collateral, wallet1Utxos, wallet1VK, cip113RewardAddress, usdcUnit, usdcAdaLpAssetName, usdcAssetB, lorenzoSmartAddr } from "./setup.js";
// // pool batching ref script
// const poolBatchingScriptTxHash = "2f1f978780f1ed0f9c8de9127fb4f376319d5dc31c0cdaf225561dc4c84ed450";
// const poolBatchingScriptTxIndex = 0;
// // pool ref script
// const poolScriptTxHash = "71ed9bb4b853e3e8a21c1ed93df58ea7c1b3996afa1e0cf39ed18108c4d1d2ac";
// const poolScriptTxIndex = 0;
// // order ref script
// const orderScriptTxHash = "6b66d721a610f07bb5e7fd77f3341f96588565af92b5b2ab068593256c68981b";
// const orderScriptTxIndex = 0;
// -------------Working hashes----------------
// pool batching ref script
const poolBatchingScriptTxHash = "85e83c7cab230207f913245a43c9c25efaa9124a69e6116cb2bb6d966364ab2a";
const poolBatchingScriptTxIndex = 0;
// pool ref script
const poolScriptTxHash = "7f3ae62c327604df8689f53ba4079f4c42e5c5dc8754c2dd27172d1d124f7f4b";
const poolScriptTxIndex = 0;
// order ref script
const orderScriptTxHash = "c5291bac8918c4067783388da62e1d68c8fb8cd75fe50dc71a74bcb8e3caae7b";
const orderScriptTxIndex = 0;
console.log("pool validator utxos number:", (await blockchainProvider.fetchAddressUTxOs(poolValidatorAddress)).length, '\n');
console.log("order validator utxos number:", (await blockchainProvider.fetchAddressUTxOs(orderValidatorAddress)).length, '\n');
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
// const usedBatcherFee = 3000000;
const usedBatcherFee = 2800000; // -> changes here
const poolBatchingRedeemer = mConStr0([
    0,
    [usedBatcherFee], // used_batcher_fee, first index: 3 ADA
    "00", // minswap used "00"
    mConStr1([]),
    [mConStr1([])] // [mConStr0([6])],
]);
// order output value
const orderLovelaceBalance = orderLovelaceAmount - usedBatcherFee;
console.log("orderLovelaceBalance", orderLovelaceBalance);
// const assetBAmount = 19; // pre-calculated on chain (just for testing)
const calculate_amount_out = (reserve_in, reserve_out, amount_in, trading_fee_numerator) => {
    const default_fee_denominator = 10000;
    let diff = default_fee_denominator - trading_fee_numerator;
    let in_with_fee = diff * amount_in;
    let numerator = in_with_fee * reserve_out;
    let denominator = default_fee_denominator * reserve_in + in_with_fee;
    return Math.floor(numerator / denominator);
};
if (!poolUtxo.output.plutusData) {
    throw new Error("No datum in pool utxo");
}
const oldPoolDatum = deserializeDatum(poolUtxo.output.plutusData); // ideal way is to create a type for the datum to deserialize; this is just for testing
const oldPoolAdaTokenSupply = oldPoolDatum.fields[4].int;
const oldPoolUsdcSupply = oldPoolDatum.fields[5].int;
const base_fee_a_numerator = 6;
// const assetBAmountTest = calculate_amount_out(oldPoolAdaTokenSupply, oldPoolUsdcSupply, 20000000, base_fee_a_numerator);
const assetBAmount = calculate_amount_out(oldPoolAdaTokenSupply, oldPoolUsdcSupply, AdaSwapAmount, base_fee_a_numerator);
// updated pool datum (calculated updated reserves based on A -> B order direction)
const updatedAdaTokenSupply = oldPoolAdaTokenSupply + AdaSwapAmount;
const updatedUsdcSupply = oldPoolUsdcSupply - assetBAmount;
console.log("updatedAdaTokenSupply:", updatedAdaTokenSupply);
console.log("updatedUsdcSupply:", updatedUsdcSupply);
const poolDatum = mConStr0([
    mConStr1([poolBatchingValidatorHash]),
    AdaAssetA,
    usdcAssetB,
    AdaTotalLiquidity,
    updatedAdaTokenSupply,
    updatedUsdcSupply,
    base_fee_a_numerator,
    6,
    mConStr1([]),
    mConStr0([]),
]);
// console.log("assetBAmount:", assetBAmount);
// console.log("assetBAmountTest:", assetBAmountTest);
console.log("oldPoolAdaTokenSupply:", oldPoolAdaTokenSupply);
console.log("oldPoolUsdcSupply:", oldPoolUsdcSupply);
console.log("lorenzoSmartAddr:", lorenzoSmartAddr);
const invalidBefore = unixTimeToEnclosingSlot(
// (Date.now() - 90000),
(Date.now() - 50000), SLOT_CONFIG_NETWORK.preview);
const invalidAfter = unixTimeToEnclosingSlot((Date.now() + 8 * 60 * 1000), // 8 mins
SLOT_CONFIG_NETWORK.preview);
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
    // .withdrawalRedeemerValue(poolBatchingRedeemer, "Mesh", { mem: rMem, steps: rSteps })
    // order output
    // .txOut(userCip113Addr, [
    .txOut(lorenzoSmartAddr, [
    { unit: "lovelace", quantity: String(orderLovelaceBalance) },
    { unit: usdcUnit, quantity: String(assetBAmount) }
])
    // pool validator output
    .txOut(poolValidatorAddress, [
    { unit: "lovelace", quantity: String(updatedAdaTokenSupply + 4500000) },
    { unit: usdcUnit, quantity: String(updatedUsdcSupply) },
    { unit: authenPolicyId + usdcAdaLpAssetName, quantity: String(AdaRemainingLiquidity) },
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
    .setFee("4108405")
    .complete();
const signedTx = await wallet1.signTx(unsignedTx);
const txHash = await wallet1.submitTx(signedTx);
console.log("pool batching tx hash:", txHash);
