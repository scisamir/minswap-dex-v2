import { deserializeDatum, mConStr0, mConStr1, SLOT_CONFIG_NETWORK, stringToHex, unixTimeToEnclosingSlot } from "@meshsdk/core";
import { alwaysSuccessMintValidatorHash, alwaysSuccessValidatorScript, AdaAssetA, assetB, authenAddress, authenPolicyId, blockchainProvider, AdaLpAssetName, orderLovelaceAmount, orderValidatorAddress, orderValidatorRewardAddress, orderValidatorScriptHash, poolAuthAssetName, poolBatchingValidatorHash, poolBatchingValidatorRewardAddress, poolValidatorAddress, poolValidatorRewardAddress, poolValidatorScriptHash, AdaRemainingLiquidity, AdaSwapAmount, AdaTotalLiquidity, txBuilder, wallet1, wallet1Address, wallet1Collateral, wallet1Utxos, wallet1VK } from "./setup.js";
// pool batching ref script
const poolBatchingScriptTxHash = "39fdbe15b1068eb8bb99b7a77288dc35f8daaeb408b018674748c59dff785e76";
const poolBatchingScriptTxIndex = 0;
// pool ref script
const poolScriptTxHash = "b636c292b0437b2a3a7c81c4bfebf9a11107479ef98d0a9e17805ffad53a8aed";
const poolScriptTxIndex = 0;
// order ref script
const orderScriptTxHash = "dfc5fe8b0fb7eb87fec203f4e83f258a751a65ae38a451c4d77616250bf40045";
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
const assetBAmount = 19; // pre-calculated on chain (just for testing)
// updated pool datum (calculated updated reserves based on A -> B order direction)
if (!poolUtxo.output.plutusData) {
    throw new Error("No datum in pool utxo");
}
const oldPoolDatum = deserializeDatum(poolUtxo.output.plutusData); // ideal way is to create a type for the datum to deserialize; this is just for testing
const updatedAdaTokenSupply = oldPoolDatum.fields[4].int + AdaSwapAmount;
const updatedMyTokenOneSupply = oldPoolDatum.fields[5].int - assetBAmount;
console.log("updatedAdaTokenSupply:", updatedAdaTokenSupply);
console.log("updatedMyTokenOneSupply:", updatedMyTokenOneSupply);
const poolDatum = mConStr0([
    mConStr1([poolBatchingValidatorHash]),
    AdaAssetA,
    assetB,
    AdaTotalLiquidity,
    updatedAdaTokenSupply,
    updatedMyTokenOneSupply,
    6,
    6,
    mConStr1([]),
    mConStr0([]),
]);
const invalidBefore = unixTimeToEnclosingSlot((Date.now() - 40000), SLOT_CONFIG_NETWORK.preview);
const invalidAfter = unixTimeToEnclosingSlot((Date.now() + 8 * 60 * 1000), // 8 mins
SLOT_CONFIG_NETWORK.preview);
const unsignedTx = await txBuilder
    // spend order utxo
    .spendingPlutusScriptV3()
    .txIn(orderUtxo.input.txHash, orderUtxo.input.outputIndex, orderUtxo.output.amount, orderUtxo.output.address)
    .txInScript(alwaysSuccessValidatorScript)
    .spendingReferenceTxInInlineDatumPresent()
    .spendingReferenceTxInRedeemerValue("")
    // withdraw script on order utxo
    .withdrawalPlutusScriptV3()
    .withdrawal(orderValidatorRewardAddress, "0")
    // .withdrawalScript(orderValidatorScript)
    .withdrawalTxInReference(orderScriptTxHash, orderScriptTxIndex, undefined, orderValidatorScriptHash)
    .withdrawalRedeemerValue(mConStr0([]))
    // spend pool utxo
    .spendingPlutusScriptV3()
    .txIn(poolUtxo.input.txHash, poolUtxo.input.outputIndex, poolUtxo.output.amount, poolUtxo.output.address)
    .txInScript(alwaysSuccessValidatorScript)
    .spendingReferenceTxInInlineDatumPresent()
    .spendingReferenceTxInRedeemerValue("")
    // withdraw script on pool utxo
    .withdrawalPlutusScriptV3()
    .withdrawal(poolValidatorRewardAddress, "0")
    // .withdrawalScript(poolValidatorScript)
    .withdrawalTxInReference(poolScriptTxHash, poolScriptTxIndex, undefined, poolValidatorScriptHash)
    .withdrawalRedeemerValue(mConStr0([]))
    // pool batching withdrawal
    .withdrawalPlutusScriptV3()
    .withdrawal(poolBatchingValidatorRewardAddress, "0")
    // .withdrawalScript(poolBatchingValidatorScript)
    .withdrawalTxInReference(poolBatchingScriptTxHash, poolBatchingScriptTxIndex, undefined, poolBatchingValidatorHash)
    .withdrawalRedeemerValue(poolBatchingRedeemer)
    // order output
    .txOut(wallet1Address, [
    { unit: "lovelace", quantity: String(orderLovelaceBalance) },
    { unit: alwaysSuccessMintValidatorHash + stringToHex("myTokenOne"), quantity: String(assetBAmount) }
])
    // pool validator output
    .txOut(poolValidatorAddress, [
    { unit: "lovelace", quantity: String(updatedAdaTokenSupply + 4500000) },
    { unit: alwaysSuccessMintValidatorHash + stringToHex("myTokenOne"), quantity: String(updatedMyTokenOneSupply) },
    { unit: authenPolicyId + AdaLpAssetName, quantity: String(AdaRemainingLiquidity) },
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
    .setFee("3491809")
    .complete();
const signedTx = await wallet1.signTx(unsignedTx);
const txHash = await wallet1.submitTx(signedTx);
console.log("pool batching tx hash:", txHash);
