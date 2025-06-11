import { mConStr0, mConStr1, mScriptAddress } from "@meshsdk/core";
import { authenPolicyId, orderLovelaceAmount, orderValidatorAddress, txBuilder, wallet1, wallet1Address, wallet1Collateral, wallet1Utxos, wallet1VK, cip113ValidatorHash, swapAmount, usdcUnit, cip113ValidatorScript, usdcCip113Utxo, usdcCip113Balance, cip113RewardAddress, usdcAdaLpAssetName } from "./setup.js";
const orderStep = mConStr0([
    mConStr0([]), // False (a_to_b_direction)
    mConStr0([swapAmount]), // swap_amount_option
    18, // minimum_receive
    mConStr0([]), // False
]);
const orderDatum = mConStr0([
    mConStr0([wallet1VK]),
    // user address has to be smart address (cip 113 address)
    mScriptAddress(cip113ValidatorHash, wallet1VK),
    mConStr0([]),
    // user address has to be smart address (cip 113 address)
    mScriptAddress(cip113ValidatorHash, wallet1VK),
    mConStr0([]),
    mConStr0([
        authenPolicyId, // policy id
        usdcAdaLpAssetName // asset name
    ]), // changes according to the related liquidity pool
    orderStep,
    6000000, // max_batcher_fee: 6 ADA
    mConStr1([]), // mConStr0([[(Date.now() + (10 * 60 * 1000)), 0]]), // 10 mins exp time; tip 0
]);
console.log("usdcCip113Balance - usdcSupply:", usdcCip113Balance - swapAmount);
const unsignedTx = await txBuilder
    // spend cip 113 utxo
    .spendingPlutusScriptV3()
    .txIn(usdcCip113Utxo.input.txHash, usdcCip113Utxo.input.outputIndex, usdcCip113Utxo.output.amount, usdcCip113Utxo.output.address)
    .txInScript(cip113ValidatorScript)
    .spendingReferenceTxInInlineDatumPresent()
    .spendingReferenceTxInRedeemerValue("")
    // cip 113 withdrawal
    .withdrawalPlutusScriptV3()
    .withdrawal(cip113RewardAddress, "0")
    .withdrawalScript(cip113ValidatorScript)
    .withdrawalRedeemerValue("")
    // cip113 provider change
    .txOut(usdcCip113Utxo.output.address, [{ unit: usdcUnit, quantity: String(usdcCip113Balance - swapAmount) }])
    // order utxo output
    .txOut(orderValidatorAddress, [
    { unit: "lovelace", quantity: String(orderLovelaceAmount) }, // batcher fee is deducted from here
    { unit: usdcUnit, quantity: String(swapAmount) },
])
    .txOutInlineDatumValue(orderDatum)
    .txInCollateral(wallet1Collateral.input.txHash, wallet1Collateral.input.outputIndex, wallet1Collateral.output.amount, wallet1Collateral.output.address)
    .changeAddress(wallet1Address)
    .selectUtxosFrom(wallet1Utxos)
    .complete();
const signedTx = await wallet1.signTx(unsignedTx);
const txHash = await wallet1.submitTx(signedTx);
console.log("Create sell order tx hash:", txHash);
