import { deserializeAddress, mConStr0 } from "@meshsdk/core";
import { authenAddress, authenPolicyId, authenValidatorScript, blockchainProvider, globalSettingAssetName, txBuilder, wallet1, wallet1Address, wallet1Collateral, wallet1Utxos, wallet1VK } from "./setup.js";
const globalSettingNftUnit = authenPolicyId + globalSettingAssetName;
const poolAuthorizationMethod = mConStr0([wallet1VK]);
const lorenzoAddress = "addr_test1qqq0cuu96g9hny47un2qcyv7qcs3u70whcdmf06mqj3pkt4wckwszdqepz35tf5h4h9mkce2p4hf3wj239pwhxswwkcq7p5gst";
const { pubKeyHash: lorenzoVK } = deserializeAddress(lorenzoAddress);
const lorenzoAuthMethod = mConStr0([lorenzoVK]);
const globalSettingDatum = mConStr0([
    [poolAuthorizationMethod, lorenzoAuthMethod],
    poolAuthorizationMethod,
    poolAuthorizationMethod,
    poolAuthorizationMethod,
    poolAuthorizationMethod,
    poolAuthorizationMethod,
]);
const txInput = (await blockchainProvider.fetchAddressUTxOs(authenAddress))[0];
console.log("Authen policy ID:", authenPolicyId);
const unsignedTx = await txBuilder
    .spendingPlutusScriptV3()
    .txIn(txInput.input.txHash, txInput.input.outputIndex, txInput.output.amount, txInput.output.address)
    .txInScript(authenValidatorScript)
    .spendingReferenceTxInInlineDatumPresent()
    .spendingReferenceTxInRedeemerValue("")
    .txOut(authenAddress, [{ unit: globalSettingNftUnit, quantity: "1" }])
    .txOutInlineDatumValue(globalSettingDatum)
    .txInCollateral(wallet1Collateral.input.txHash, wallet1Collateral.input.outputIndex, wallet1Collateral.output.amount, wallet1Collateral.output.address)
    .changeAddress(wallet1Address)
    .selectUtxosFrom(wallet1Utxos)
    .complete();
const signedTx = await wallet1.signTx(unsignedTx);
const txHash = await wallet1.submitTx(signedTx);
console.log("Update global settings tx hash:", txHash);
