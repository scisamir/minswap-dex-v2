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
const AnotherAuthMethod = getAuthMethod("addr1qyd6f6ypkucxdma33m6wv7leg5jajum4xn6gfwjhp5slc9nl9sl3502wy3l6k36gzauqjcu40cj0pu4c33f00c5ggq9qsa2nql");
const globalSettingDatum = mConStr0([
    [poolAuthorizationMethod, lorenzoAuthMethod, AnotherAuthMethod],
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
