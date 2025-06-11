import { mConStr0, mConStr1, stringToHex } from "@meshsdk/core";
import { AdaAssetA, alwaysSuccessMintValidatorHash, assetB, authenPolicyId, blockchainProvider, factoryAddress, factoryAssetName, factoryValidatorScript, AdaTokenSupply, AdaLpAssetName, maxInt64, myTokenOneSupply, poolAuthAssetName, poolBatchingValidatorHash, poolValidatorAddress, AdaRemainingLiquidity, AdaTotalLiquidity, txBuilder, wallet1, wallet1Address, wallet1Collateral, wallet1Utxos } from "./setup.js";
// Authen
const authenScriptTxHash = "005e3c25687a1d5b4185e00b9f0c874cd1934bc02fb94ea57d859df54448db6e";
const authenScriptTxIndex = 0;
// Factory
// const factoryScriptTxHash = "";
// const factoryScriptTxIndex = 0;
const factoryUtxos = await blockchainProvider.fetchAddressUTxOs(factoryAddress);
const factoryInput = factoryUtxos[factoryUtxos.length - 1];
if (!factoryInput) {
    throw new Error('Factory input not found');
}
const factoryRedeemer = mConStr0([
    AdaAssetA,
    assetB,
]);
// console.log("Asset A unit:", alwaysSuccessMintValidatorHash, tokenA);
// console.log("Asset B unit:", alwaysSuccessMintValidatorHash, tokenB);
const factoryNftUnit = authenPolicyId + factoryAssetName;
const factoryDatum1 = mConStr0([
    "00",
    AdaLpAssetName,
]);
const factoryDatum2 = mConStr0([
    AdaLpAssetName,
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00",
]);
// pool datum
const poolDatum = mConStr0([
    mConStr1([poolBatchingValidatorHash]),
    AdaAssetA,
    assetB,
    AdaTotalLiquidity,
    AdaTokenSupply,
    myTokenOneSupply,
    6,
    6,
    mConStr1([]),
    mConStr0([]), // ??
]);
// console.log("AdaTotalLiquidity:", AdaTotalLiquidity, '\n');
// console.log("AdaRemainingLiquidity:", AdaRemainingLiquidity, '\n');
// console.log("AdaRemainingLiquidity String:", String(AdaRemainingLiquidity), '\n');
const unsignedTx = await txBuilder
    // consume last factory UTxO
    .spendingPlutusScriptV3()
    .txIn(factoryInput.input.txHash, factoryInput.input.outputIndex, factoryInput.output.amount, factoryInput.output.address)
    .txInScript(factoryValidatorScript)
    // .spendingTxInReference(factoryScriptTxHash, factoryScriptTxIndex)
    .spendingReferenceTxInInlineDatumPresent()
    .spendingReferenceTxInRedeemerValue(factoryRedeemer)
    // mint pool factory NFT
    .mintPlutusScriptV3()
    .mint("1", authenPolicyId, factoryAssetName)
    // .mintingScript(authenValidatorScript)
    .mintTxInReference(authenScriptTxHash, authenScriptTxIndex)
    .mintRedeemerValue(mConStr1([]))
    // mint pool NFT
    .mintPlutusScriptV3()
    .mint("1", authenPolicyId, poolAuthAssetName)
    // .mintingScript(authenValidatorScript)
    .mintTxInReference(authenScriptTxHash, authenScriptTxIndex)
    .mintRedeemerValue(mConStr1([]))
    // mint lp tokens
    .mintPlutusScriptV3()
    .mint(String(maxInt64), authenPolicyId, AdaLpAssetName)
    // .mintingScript(authenValidatorScript)
    .mintTxInReference(authenScriptTxHash, authenScriptTxIndex)
    .mintRedeemerValue(mConStr1([]))
    // previous element of factory linked list
    .txOut(factoryAddress, [{ unit: factoryNftUnit, quantity: "1" }])
    .txOutInlineDatumValue(factoryDatum1)
    // next element of factory linked list
    .txOut(factoryAddress, [{ unit: factoryNftUnit, quantity: "1" }])
    .txOutInlineDatumValue(factoryDatum2)
    // pool validator output
    .txOut(poolValidatorAddress, [
    // add min_ada to ada supply
    { unit: "lovelace", quantity: String(AdaTokenSupply + 4500000) },
    { unit: alwaysSuccessMintValidatorHash + stringToHex("myTokenOne"), quantity: String(myTokenOneSupply) },
    { unit: authenPolicyId + AdaLpAssetName, quantity: String(AdaRemainingLiquidity) },
    { unit: authenPolicyId + poolAuthAssetName, quantity: "1" },
])
    .txOutInlineDatumValue(poolDatum)
    .txInCollateral(wallet1Collateral.input.txHash, wallet1Collateral.input.outputIndex, wallet1Collateral.output.amount, wallet1Collateral.output.address)
    .changeAddress(wallet1Address)
    .selectUtxosFrom(wallet1Utxos)
    .complete();
const signedTx = await wallet1.signTx(unsignedTx);
const txHash = await wallet1.submitTx(signedTx);
console.log("Create pool tx hash:", txHash);
