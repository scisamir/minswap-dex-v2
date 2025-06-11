import { deserializeDatum, mConStr0, mConStr1, SLOT_CONFIG_NETWORK, unixTimeToEnclosingSlot } from "@meshsdk/core";
import { cip113ValidatorScript, AdaAssetA, authenAddress, authenPolicyId, blockchainProvider, orderLovelaceAmount, orderValidatorAddress, orderValidatorRewardAddress, orderValidatorScriptHash, poolAuthAssetName, poolBatchingValidatorHash, poolBatchingValidatorRewardAddress, poolValidatorAddress, poolValidatorRewardAddress, poolValidatorScriptHash, AdaRemainingLiquidity, AdaTotalLiquidity, txBuilder, wallet1, wallet1Address, wallet1Collateral, wallet1Utxos, wallet1VK, cip113RewardAddress, userCip113Addr, usdcAssetB, swapAmount, usdcAdaLpAssetName, usdcUnit } from "./setup.js";
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
const usedBatcherFee = 3000000;
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
const adaSellOrderAmount = 20241174; // pre-calculated on chain (just for testing)
// updated pool datum (calculated updated reserves based on A -> B order direction)
if (!poolUtxo.output.plutusData) {
    throw new Error("No datum in pool utxo");
}
const oldPoolDatum = deserializeDatum(poolUtxo.output.plutusData); // ideal way is to create a type for the datum to deserialize; this is just for testing
const updatedAdaTokenSupply = oldPoolDatum.fields[4].int - adaSellOrderAmount;
const updatedUsdcSupply = oldPoolDatum.fields[5].int + swapAmount;
console.log("updatedAdaTokenSupply:", updatedAdaTokenSupply);
console.log("updatedUsdcSupply:", updatedUsdcSupply);
console.log(oldPoolDatum.fields[4].int, oldPoolDatum.fields[5].int);
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
const invalidBefore = unixTimeToEnclosingSlot((Date.now() - 45000), SLOT_CONFIG_NETWORK.preview);
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
    // .withdrawalRedeemerValue(poolBatchingRedeemer)
    // .withdrawalRedeemerValue(poolBatchingRedeemer, "Mesh", { mem: rMem, steps: rSteps })
    // order output
    .txOut(userCip113Addr, [
    { unit: "lovelace", quantity: String(orderLovelaceBalance + adaSellOrderAmount) },
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
    // .setFee("9461061")
    .complete();
const signedTx = await wallet1.signTx(unsignedTx);
const txHash = await wallet1.submitTx(signedTx);
console.log("pool batching tx hash:", txHash);
