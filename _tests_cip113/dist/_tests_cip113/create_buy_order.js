import { mConStr0, mConStr1, mScriptAddress } from "@meshsdk/core";
import { authenPolicyId, orderLovelaceAmount, orderValidatorAddress, AdaSwapAmount, txBuilder, wallet1, wallet1Address, wallet1Collateral, wallet1Utxos, wallet1VK, cip113ValidatorHash, usdcAdaLpAssetName } from "./setup.js";
const orderStep = mConStr0([
    mConStr1([]), // True (a_to_b_direction)
    mConStr0([AdaSwapAmount]), // swap_amount_option
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
console.log("usdcAdaLpAssetName:", usdcAdaLpAssetName);
const unsignedTx = await txBuilder
    .txOut(orderValidatorAddress, [
    { unit: "lovelace", quantity: String(orderLovelaceAmount + AdaSwapAmount) }, // batcher fee is deducted from here
])
    .txOutInlineDatumValue(orderDatum)
    .txInCollateral(wallet1Collateral.input.txHash, wallet1Collateral.input.outputIndex, wallet1Collateral.output.amount, wallet1Collateral.output.address)
    .changeAddress(wallet1Address)
    .selectUtxosFrom(wallet1Utxos)
    .complete();
const signedTx = await wallet1.signTx(unsignedTx);
const txHash = await wallet1.submitTx(signedTx);
console.log("Create buy order tx hash:", txHash);
