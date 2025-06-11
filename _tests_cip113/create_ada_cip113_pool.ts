import { mConStr0, mConStr1, stringToHex } from "@meshsdk/core";
import { AdaAssetA, authenPolicyId, authenValidatorScript, blockchainProvider, calculateInitialLiquidity, factoryAddress, factoryAssetName, factoryValidatorScript, AdaTokenSupply, maxInt64, poolAuthAssetName, poolBatchingValidatorHash, poolValidatorAddress, AdaRemainingLiquidity, AdaTotalLiquidity, txBuilder, wallet1, wallet1Address, wallet1Collateral, wallet1Utxos, cip113ValidatorScript, cip113RewardAddress, usdcUnit, usdcSupply, usdcAssetB, usdcAdaLpAssetName, usdcCip113Balance, usdcCip113Utxo } from "./setup.js"

// Authen
const authenScriptTxHash = "0c667ca29e60e09c80dab8ebd8a6378c3b97b9a41021b710cd8af36fbe520503";
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
    usdcAssetB,
]);

// console.log("Asset A unit:", alwaysSuccessMintValidatorHash, tokenA);
// console.log("Asset B unit:", alwaysSuccessMintValidatorHash, tokenB);

const factoryNftUnit = authenPolicyId + factoryAssetName;
const factoryDatum1 = mConStr0([
    "00",
    usdcAdaLpAssetName,
]);
const factoryDatum2 = mConStr0([
    usdcAdaLpAssetName,
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00",
]);

// pool datum
const poolDatum = mConStr0([
    mConStr1([poolBatchingValidatorHash]),
    AdaAssetA,
    usdcAssetB,
    AdaTotalLiquidity,
    AdaTokenSupply,
    usdcSupply,
    6,
    6,
    mConStr1([]),
    mConStr0([]), // ??
]);

console.log("usdcCip113Balance - usdcSupply:", usdcCip113Balance - usdcSupply);

// console.log("AdaTotalLiquidity:", AdaTotalLiquidity, '\n');
// console.log("AdaRemainingLiquidity:", AdaRemainingLiquidity, '\n');
// console.log("AdaRemainingLiquidity String:", String(AdaRemainingLiquidity), '\n');

const unsignedTx = await txBuilder
    // consume last factory UTxO
    .spendingPlutusScriptV3()
    .txIn(
        factoryInput.input.txHash,
        factoryInput.input.outputIndex,
        factoryInput.output.amount,
        factoryInput.output.address,
    )
    .txInScript(factoryValidatorScript)
    // .spendingTxInReference(factoryScriptTxHash, factoryScriptTxIndex)
    .spendingReferenceTxInInlineDatumPresent()
    .spendingReferenceTxInRedeemerValue(factoryRedeemer)
    // spend myTokenOneCip113Utxo input
    .spendingPlutusScriptV3()
    .txIn(
        usdcCip113Utxo.input.txHash,
        usdcCip113Utxo.input.outputIndex,
        usdcCip113Utxo.output.amount,
        usdcCip113Utxo.output.address,
    )
    .txInScript(cip113ValidatorScript)
    .spendingReferenceTxInInlineDatumPresent()
    .spendingReferenceTxInRedeemerValue("")
    // execute withdraw 0 on cip113 contract
    .withdrawalPlutusScriptV3()
    .withdrawal(cip113RewardAddress, "0")
    .withdrawalScript(cip113ValidatorScript)
    .withdrawalRedeemerValue("")
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
    .mint(String(maxInt64), authenPolicyId, usdcAdaLpAssetName)
    // .mintingScript(authenValidatorScript)
    .mintTxInReference(authenScriptTxHash, authenScriptTxIndex)
    .mintRedeemerValue(mConStr1([]))
    // previous element of factory linked list
    .txOut(factoryAddress, [{ unit: factoryNftUnit, quantity: "1" }])
    .txOutInlineDatumValue(factoryDatum1)
    // next element of factory linked list
    .txOut(factoryAddress, [{ unit: factoryNftUnit, quantity: "1" }])
    .txOutInlineDatumValue(factoryDatum2)
    // Return myTokenOneCip113 back to cip 113 addr
    .txOut(usdcCip113Utxo.output.address, [{ unit: usdcUnit, quantity: String(usdcCip113Balance - usdcSupply) }])
    // pool validator output
    .txOut(poolValidatorAddress, [
        // add min_ada to ada supply
        { unit: "lovelace", quantity: String(AdaTokenSupply + 4500000) },
        { unit: usdcUnit, quantity: String(usdcSupply) },
        { unit: authenPolicyId + usdcAdaLpAssetName, quantity: String(AdaRemainingLiquidity) },
        { unit: authenPolicyId + poolAuthAssetName, quantity: "1" },
    ])
    .txOutInlineDatumValue(poolDatum)
    .txInCollateral(
        wallet1Collateral.input.txHash,
        wallet1Collateral.input.outputIndex,
        wallet1Collateral.output.amount,
        wallet1Collateral.output.address,
    )
    .changeAddress(wallet1Address)
    .selectUtxosFrom(wallet1Utxos)
    .complete()

const signedTx = await wallet1.signTx(unsignedTx);
const txHash = await wallet1.submitTx(signedTx);

console.log("Create cip113 pool tx hash:", txHash);
