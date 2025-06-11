import { mConStr1 } from "@meshsdk/core";
import { blockchainProvider, orderValidatorScript, orderValidatorAddress, txBuilder, wallet1, wallet1Address, wallet1Collateral, wallet1Utxos, wallet1VK, orderValidatorRewardAddress, cip113ValidatorScript, cip113RewardAddress, userCip113Addr } from "./setup.js";
// console.log("orderValidatorAddress:", orderValidatorAddress);
const orderUtxo = (await blockchainProvider.fetchAddressUTxOs(orderValidatorAddress))[0];
if (!orderUtxo) {
    throw new Error("order utxo not found!");
}
console.log("orderUtxo:", orderUtxo);
console.log("wallet1VK:", wallet1VK);
// order ref script
const orderScriptTxHash = "";
const orderScriptTxIndex = 0;
// const rMem = 1500000;
// const rSteps = 1000000000;
const unsignedTx = await txBuilder
    .spendingPlutusScriptV3()
    .txIn(orderUtxo.input.txHash, orderUtxo.input.outputIndex, orderUtxo.output.amount, orderUtxo.output.address)
    .txInScript(cip113ValidatorScript)
    .spendingReferenceTxInInlineDatumPresent()
    .spendingReferenceTxInRedeemerValue("")
    // .spendingReferenceTxInRedeemerValue("", "Mesh", { mem: rMem, steps: rSteps })
    // withdraw cip113
    .withdrawalPlutusScriptV3()
    .withdrawal(cip113RewardAddress, "0")
    .withdrawalScript(cip113ValidatorScript)
    .withdrawalRedeemerValue("")
    // .withdrawalRedeemerValue("", "Mesh", { mem: rMem, steps: rSteps })
    // withdraw zero
    .withdrawalPlutusScriptV3()
    .withdrawal(orderValidatorRewardAddress, "0")
    .withdrawalScript(orderValidatorScript)
    // .withdrawalTxInReference(orderScriptTxHash, orderScriptTxIndex, undefined, orderValidatorScriptHash)
    .withdrawalRedeemerValue(mConStr1([]))
    // .withdrawalRedeemerValue(mConStr1([]), "Mesh", { mem: rMem, steps: rSteps })
    // tx out
    .txOut(userCip113Addr, orderUtxo.output.amount)
    .txInCollateral(wallet1Collateral.input.txHash, wallet1Collateral.input.outputIndex, wallet1Collateral.output.amount, wallet1Collateral.output.address)
    .changeAddress(wallet1Address)
    .selectUtxosFrom(wallet1Utxos)
    .requiredSignerHash(wallet1VK)
    .complete();
const signedTx = await wallet1.signTx(unsignedTx);
const txHash = await wallet1.submitTx(signedTx);
console.log("Cancel order by owner tx hash:", txHash);
