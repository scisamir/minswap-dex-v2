import { applyParamsToScript, resolveScriptHash, serializePlutusScript, serializeRewardAddress, stringToHex } from "@meshsdk/core";
import { blockchainProvider, txBuilder, wallet1, wallet1Address, wallet1Collateral, wallet1Utxos, wallet1VK, wallet2VK } from "./setup.js";
const compiledCode = "59057701010032323232323232253330023232323232323232323253232323233301030020091323322325333014300730153754002264a66602a600e602c6ea80044cc02cdd59805180b9baa011300933019301a3017375400297ae016300c301637546018602c6ea8c02cc058dd5180c980b1baa00116323300100137586018602c6ea8040894ccc060004530103d87a80001332253330173375e601e60326ea80080184c020cc06c0092f5c026600800800260340026036002602c002602c602e00260246ea80284c8c8c8c8c94ccc054cdc3a400801c2646464a666030601460326ea800c4c94ccc064c8cc004004c8cc004004dd61809980e9baa01722533301f00114bd7009991299980f19baf301630203754602c60406ea8c054c080dd50011809198111ba90064bd70099811001198020020008998020020009810800981100091299980f0008a5113322533301d32533301e3011301f3754002264a66603e602460406ea80044c94ccc080c04cc084dd50008998061bae3025302237540020382c604860426ea800458c08cc080dd50008b180a180f9baa3015301f37546028603e6ea80084cc01001000452818100009810800899b87337006660046eb0c044c06cdd500aa40004464a666038601c603a6ea800454ccc070cdc79bae3021301e3754002008266e00ccc018dd59809980f1baa3013301e37540060089101045553444300002100210023013301d37546026603a6ea8c048c074dd50011998019bab3006301b375402a0029110455534443003330023758603c603e603e60366ea805520002232533301c300e301d37540022a66603866e3cdd71810980f1baa00100413370066600c6eacc04cc078dd50018022441045553444300002100210023013301d37546026603a6ea80085281bae301d301a37540062c44464666002002008006444a66604000420022666006006604600466008604400400244464a666034601860366ea8004520001375a603e60386ea8004c94ccc068c030c06cdd50008a6103d87a80001323300100137566040603a6ea8008894ccc07c004530103d87a80001323332225333020337220100062a66604066e3c02000c4c044cc090dd400125eb80530103d87a8000133006006001375c603c0026eb4c07c004c08c008c084004cc02400c008c068c05cdd50078a99980a98040070991980124411c66ec634b007c666a96a8e4b89c621a6dfebf29390948f8ecc047faf200012375c6034602e6ea803c5888c94ccc05cc8cc004004dd6180e980f180f180f180f180f180f180f180f180d1baa00322533301c00114a026644a66603666e3c00801c5288998020020009bae301e001301f00114a22a66602e6601a6eacc030c064dd500118059980d9ba90034bd700a511533301732330010013758602060346ea800c894ccc07000452809991299980d99baf3020301d37546040603a6ea8c080c084c074dd500118061980f9ba90074bd700a51133004004001301e001301f00114a2266602e601400294128980219299980b9804980c1baa00114bd6f7b63009bab301c301937540026600c6eacc00cc060dd50008011180c980d180d180d180d000980080091299980b0008a4000266e01200233002002301900122323300100100322533301700114c103d87a800013233322253330183372200e0062a66603066e3c01c00c4c024cc070dd300125eb80530103d87a8000133006006001375c602c0026eacc05c004c06c008c064004dd2a40006e1d2002370e90001ba5480088c044c048c048c048c048c048c04800488c8cc00400400c894ccc04400452809991299980819baf00500214a2266008008002601e602600260280024601e60200024601c00260106ea8004c02cc03000cc028008c024008c024004c010dd50008a4c26cacae6955ceaab9e5573eae815d0aba21";
export function get_cip113_script() {
    const scriptCbor = applyParamsToScript(compiledCode, [], "Mesh");
    const scriptAddr = serializePlutusScript({ code: scriptCbor, version: "V3" }).address;
    const policy = resolveScriptHash(scriptCbor, "V3");
    let rewardAddress = serializeRewardAddress(policy, true, //here is true for contracts 
    0);
    // console.log(policy);
    return { scriptCbor, scriptAddr, policy, rewardAddress };
}
const { scriptCbor, scriptAddr, policy, rewardAddress } = get_cip113_script();
// Register stake credential tx
// const unsignedTx = await txBuilder
//     .registerStakeCertificate(rewardAddress)
//     .selectUtxosFrom(wallet1Utxos)
//     .changeAddress(wallet1Address)
//     .complete();
// const signedTx = await wallet1.signTx(unsignedTx);
// const txHash = await wallet1.submitTx(signedTx);
// console.log("register cip113 stake certificate tx hash:", txHash);
// register cip113 stake certificate tx hash: 56e5c044c54bfc0f33813ed7287e67bac7d46043feb6b4dcb338e5fd7695a216
const cip113Utxo = (await blockchainProvider.fetchUTxOs("7c6d01e8be9f08b679a682c8537554d8b18cde95dfc7110d9e550b26bf8d4b16", 1))[0];
if (!cip113Utxo) {
    throw new Error("Could not fetch cip113 utxo");
}
// console.log("cip113Utxo:", cip113Utxo);
const senderSmartAddr = serializePlutusScript({ code: scriptCbor, version: "V3" }, wallet1VK, 0).address;
const receiverSmartAddr = serializePlutusScript({ code: scriptCbor, version: "V3" }, wallet2VK, 0).address;
// console.log("senderSmartAddr:", senderSmartAddr);
const assetNameHex = stringToHex("USDC");
const assetUnit = policy + assetNameHex;
const unsignedTx = await txBuilder
    // spend cip113 input
    .spendingPlutusScriptV3()
    .txIn(cip113Utxo.input.txHash, cip113Utxo.input.outputIndex, cip113Utxo.output.amount, cip113Utxo.output.address)
    .txInScript(scriptCbor)
    .spendingReferenceTxInInlineDatumPresent()
    .spendingReferenceTxInRedeemerValue("")
    // execute withdraw 0 on cip113 contract
    .withdrawalPlutusScriptV3()
    .withdrawal(rewardAddress, "0")
    .withdrawalScript(scriptCbor)
    .withdrawalRedeemerValue("")
    // send smart tokens to another smart address
    .txOut(receiverSmartAddr, [{ unit: assetUnit, quantity: "100000" }])
    // send smart tokens remaining back to sender smart address
    .txOut(senderSmartAddr, [{ unit: assetUnit, quantity: "500000" }])
    .txInCollateral(wallet1Collateral.input.txHash, wallet1Collateral.input.outputIndex, wallet1Collateral.output.amount, wallet1Collateral.output.address)
    .changeAddress(wallet1Address)
    .selectUtxosFrom(wallet1Utxos)
    .requiredSignerHash(wallet1VK)
    .complete();
const signedTx = await wallet1.signTx(unsignedTx);
const txHash = await wallet1.submitTx(signedTx);
console.log("CIP113 transfer tx hash:", txHash);
