import { deserializeAddress, mConStr0 } from "@meshsdk/core";
import { authenAddress, authenPolicyId, authenValidatorScript, blockchainProvider, globalSettingAssetName, txBuilder, wallet1, wallet1Address, wallet1Collateral, wallet1Utxos, wallet1VK, wallet2VK, } from "./setup.js";
const globalSettingNftUnit = authenPolicyId + globalSettingAssetName;
const getAuthMethod = (address) => {
    const { pubKeyHash: newVK } = deserializeAddress(address);
    const newBatcher = mConStr0([newVK]);
    return newBatcher;
};
const poolAuthorizationMethod = mConStr0([wallet1VK]);
const ExtraAuthMethod = mConStr0([wallet2VK]);
const lorenzoAuthMethod = getAuthMethod("addr1q89h2jxj8wr7u0hw7fdv55v5q8evav05p4tcrheavldr77sv2rhpkt2v62f7e48xz6v4vyes93sfnp3q9p6qxmszghjqj6n8h6");
// const AnotherAuthMethod = getAuthMethod("addr_test1qrc2acqmw4d6u72thft9a8eddlwzscrs3ewnquxnzdfefl2rvrppl4x24vc63cyx3ca5r0kyfpde5dvc8xrcq8l3q7zqkxvd3c");
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
    .requiredSignerHash(wallet1VK)
    .complete();
const signedTx = await wallet1.signTx(unsignedTx);
const txHash = await wallet1.submitTx(signedTx);
console.log("Update global settings tx hash:", txHash);
