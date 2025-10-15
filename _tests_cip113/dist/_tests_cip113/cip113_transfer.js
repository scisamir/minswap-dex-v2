import { serializePlutusScript, stringToHex } from "@meshsdk/core";
import { blockchainProvider, cip113RewardAddress, cip113ValidatorHash, cip113ValidatorScript, lorenzoSmartAddr, lorenzoVK, wallet1VK } from "./setup.js";
// const compiledCode = cip113Validator[0].compiledCode;
// export function get_cip113_script() {
//   const scriptCbor = applyParamsToScript(
//     compiledCode,
//     [],
//     "Mesh",
//   );
//   const scriptAddr = serializePlutusScript(
//     { code: scriptCbor, version: "V3" }
//   ).address;
//   const policy= resolveScriptHash(scriptCbor, "V3");
//   let rewardAddress = serializeRewardAddress( 
//     policy,  
//     true, //here is true for contracts 
//     0, //testnet or mainnet 
//   );
//   // console.log(policy);
//   return { scriptCbor, scriptAddr, policy, rewardAddress };
// }
// const { scriptCbor, scriptAddr, policy, rewardAddress } = get_cip113_script();
const { scriptCbor, scriptAddr, policy, rewardAddress } = {
    scriptCbor: cip113ValidatorScript,
    scriptAddr: "",
    policy: cip113ValidatorHash,
    rewardAddress: cip113RewardAddress,
};
// Register stake credential tx
// const unsignedTx = await txBuilder
//     .registerStakeCertificate(rewardAddress)
//     .selectUtxosFrom(wallet1Utxos)
//     .changeAddress(wallet1Address)
//     .complete();
// const signedTx = await wallet1.signTx(unsignedTx);
// const txHash = await wallet1.submitTx(signedTx);
// console.log("register cip113 stake certificate tx hash:", txHash);
// register cip113 stake certificate tx hash: c65ca3f6684fcac440417fcff8ff887ba349ff6de30327b428a908cb6c1f4008
const cip113Utxo = (await blockchainProvider.fetchUTxOs("cab914aca4fb11f8ed0d736915cc77a756a0b3abd8baebb2a39c734b60849c2e", 0))[0];
if (!cip113Utxo) {
    throw new Error("Could not fetch cip113 utxo");
}
console.log("cip113Utxo:", cip113Utxo);
const senderSmartAddr = serializePlutusScript({ code: scriptCbor, version: "V3" }, wallet1VK, 0).address;
// const receiverSmartAddr = serializePlutusScript(
//   { code: scriptCbor, version: "V3" },
//   wallet2VK,
//   0,
// ).address;
console.log("cip113ValidatorHash:", cip113ValidatorHash);
console.log("lorenzoVK:", lorenzoVK);
console.log("lorenzoSmartAddr:", lorenzoSmartAddr);
const assetNameHex = stringToHex("realUSDC");
const assetUnit = policy + assetNameHex;
const cip113AddrUtxos = await blockchainProvider.fetchAddressUTxOs(senderSmartAddr);
// console.log("cip addr utxos:", cip113AddrUtxos);
// // console.log("senderSmartAddr:", senderSmartAddr);
for (let i = 0; i < cip113AddrUtxos.length; i++) {
    console.log(cip113AddrUtxos[i].input.txHash, cip113AddrUtxos[i].input.outputIndex, cip113AddrUtxos[i].output.amount);
}
// console.log("order utxos:", (await blockchainProvider.fetchAddressUTxOs(orderValidatorAddress)));
// console.log("orderValidatorAddress:", orderValidatorAddress);
// Mint CIP 113 tokens
// const unsignedTx = await txBuilder
//   .mintPlutusScriptV3()
//   .mint("2000000", policy, assetNameHex)
//   .mintingScript(scriptCbor)
//   .mintRedeemerValue("")
//   .txOut(senderSmartAddr, [ { unit: assetUnit, quantity: "2000000" } ])
//   .txInCollateral(
//     wallet1Collateral.input.txHash,
//     wallet1Collateral.input.outputIndex,
//     wallet1Collateral.output.amount,
//     wallet1Collateral.output.address,
//   )
//   .changeAddress(wallet1Address)
//   .selectUtxosFrom(wallet1Utxos)
//   .requiredSignerHash(wallet1VK)
//   .complete()
// const signedTx = await wallet1.signTx(unsignedTx);
// const txHash = await wallet1.submitTx(signedTx);
// console.log("mint assets tx hash:", txHash);
// mint assets tx hash: b5b4fc3fa0bad70793f1f40343c48f4269022113bcdd9e0e2c20d7533bb7f766
// CIP113 transfer
// const unsignedTx = await txBuilder
//   // spend cip113 input
//   .spendingPlutusScriptV3()
//   .txIn(
//       cip113Utxo.input.txHash,
//       cip113Utxo.input.outputIndex,
//       cip113Utxo.output.amount,
//       cip113Utxo.output.address,
//   )
//   .txInScript(scriptCbor)
//   .spendingReferenceTxInInlineDatumPresent()
//   .spendingReferenceTxInRedeemerValue("")
//   // execute withdraw 0 on cip113 contract
//   .withdrawalPlutusScriptV3()
//   .withdrawal(rewardAddress, "0")
//   .withdrawalScript(scriptCbor)
//   .withdrawalRedeemerValue("")
//   // send smart tokens to another smart address
//   .txOut(lorenzoSmartAddr, [ { unit: assetUnit, quantity: "100000" } ])
//   // send smart tokens remaining back to sender smart address
//   .txOut(senderSmartAddr, [ { unit: assetUnit, quantity: "1895400" } ])
//   .txInCollateral(
//     wallet1Collateral.input.txHash,
//     wallet1Collateral.input.outputIndex,
//     wallet1Collateral.output.amount,
//     wallet1Collateral.output.address,
//   )
//   .changeAddress(wallet1Address)
//   .selectUtxosFrom(wallet1Utxos)
//   .requiredSignerHash(wallet1VK)
//   .complete()
// const signedTx = await wallet1.signTx(unsignedTx);
// const txHash = await wallet1.submitTx(signedTx);
// console.log("CIP113 transfer tx hash:", txHash);
// CIP113 transfer tx hash: e32a0b5d957755f69f34da24a443709266b68adc183d48e3dbbbca568e8cf065
// Spend ADA only smart token
// const unsignedTx = await txBuilder
//   // spend cip113 input
//   .spendingPlutusScriptV3()
//   .txIn(
//       cip113Utxo.input.txHash,
//       cip113Utxo.input.outputIndex,
//       cip113Utxo.output.amount,
//       cip113Utxo.output.address,
//   )
//   .txInScript(scriptCbor)
//   .spendingReferenceTxInInlineDatumPresent()
//   .spendingReferenceTxInRedeemerValue("")
//   // execute withdraw 0 on cip113 contract
//   .withdrawalPlutusScriptV3()
//   .withdrawal(rewardAddress, "0")
//   .withdrawalScript(scriptCbor)
//   .withdrawalRedeemerValue("")
//   // send ada to smart address
//   .txOut(senderSmartAddr, [ { unit: "lovelace", quantity: "4000000" } ])
//   .txInCollateral(
//     wallet1Collateral.input.txHash,
//     wallet1Collateral.input.outputIndex,
//     wallet1Collateral.output.amount,
//     wallet1Collateral.output.address,
//   )
//   .changeAddress(wallet1Address)
//   .selectUtxosFrom(wallet1Utxos)
//   .requiredSignerHash(wallet1VK)
//   .complete()
// const signedTx = await wallet1.signTx(unsignedTx);
// const txHash = await wallet1.submitTx(signedTx);
// console.log("CIP113 ada transfer tx hash:", txHash);
// CIP113 ada transfer tx hash: 608e769ae2cdcb6ceec501a84b62a7b6791a3553b529e7032c8f766c80997017
// Send ADA only value
// const unsignedTx = await txBuilder
//   // send ada to smart address
//   .txOut(senderSmartAddr, [ { unit: "lovelace", quantity: "5000000" } ])
//   .txInCollateral(
//     wallet1Collateral.input.txHash,
//     wallet1Collateral.input.outputIndex,
//     wallet1Collateral.output.amount,
//     wallet1Collateral.output.address,
//   )
//   .changeAddress(wallet1Address)
//   .selectUtxosFrom(wallet1Utxos)
//   .requiredSignerHash(wallet1VK)
//   .complete()
// const signedTx = await wallet1.signTx(unsignedTx);
// const txHash = await wallet1.submitTx(signedTx);
// console.log("CIP113 ada send tx hash:", txHash);
// CIP113 ada send tx hash: fda4d6fa742ff0978306dbc67818f7397f9822fefbfec9e2cfc182038864d976
// Send myTokenOne
// const unsignedTx = await txBuilder
//   // send myTokenOne to smart address
//   .txOut(senderSmartAddr, [ { unit: alwaysSuccessMintValidatorHash + stringToHex("myTokenOne"), quantity: String(30000) } ])
//   .txInCollateral(
//     wallet1Collateral.input.txHash,
//     wallet1Collateral.input.outputIndex,
//     wallet1Collateral.output.amount,
//     wallet1Collateral.output.address,
//   )
//   .changeAddress(wallet1Address)
//   .selectUtxosFrom(wallet1Utxos)
//   .requiredSignerHash(wallet1VK)
//   .complete()
// const signedTx = await wallet1.signTx(unsignedTx);
// const txHash = await wallet1.submitTx(signedTx);
// console.log("CIP113 myTokenOne send tx hash:", txHash);
// CIP113 ada send tx hash: fda4d6fa742ff0978306dbc67818f7397f9822fefbfec9e2cfc182038864d976
