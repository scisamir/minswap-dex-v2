import {
  MeshTxBuilder,
  deserializeAddress,
  serializeAddressObj,
  resolveStakeKeyHash,
  resolveRewardAddress,
  scriptAddress,
} from "@meshsdk/core";
const { default: protocolBoostrap } = await import("./protocolBoostrap.json", {
  with: { type: "json" },
});
const { default: blueprint } = await import("./blueprint.json", {
  with: { type: "json" },
});
import { blockchainProvider, wallet1SK, wallet1VK } from "../setup.js";

const programmableLogicGlobalScriptHash =
  protocolBoostrap.programmableLogicBaseParams.scriptHash;
// --- Addresses & Credentials ---
// User's smart wallet address
const smartWalletAddr = serializeAddressObj(
  scriptAddress(programmableLogicGlobalScriptHash, wallet1SK),
  0
);

const sAddr =
  "addr_test1zreps2cq5daaw3hzq46untcp4vcnzgsn29xdx8589c9z50ss5qwgajhq0g92xjfuz4w7fjpztpd47thujf2rly7n03jsfsj8xj";
const deserializeSAddr = deserializeAddress(sAddr);
console.log(
  `sAddr: ${deserializeSAddr.pubKeyHash}; ${deserializeSAddr.scriptHash}; ${deserializeSAddr.stakeCredentialHash}; ${deserializeSAddr.stakeScriptCredentialHash}`
);

console.log(
  "programmableLogicGlobalScriptHash:",
  programmableLogicGlobalScriptHash
);
console.log("wallet1VK:", wallet1VK);
console.log("wallet1SK:", wallet1SK);

console.log("smartWalletAddr:", smartWalletAddr);
const smartWalletAddrUtxos =
  await blockchainProvider.fetchAddressUTxOs(smartWalletAddr);
const sAddrUtxos = await blockchainProvider.fetchAddressUTxOs(sAddr);
console.log("smartWalletAddrUtxos:", smartWalletAddrUtxos);
console.log("sAddrUtxos:", sAddrUtxos);

// Reward address for programmable_logic_global (stake validator)
// const globalRewardAddr = resolveRewardAddress(
//   programmableLogicGlobalScriptHash
// );

// // Reward address for the transfer_logic_script (from registryNode datum)
// const transferLogicRewardAddr = resolveRewardAddress(transferLogicScriptHash);

// // --- Build TX ---
// const tx = await new MeshTxBuilder({ fetcher: provider })
//   // 1. Spend UTxO from smart wallet
//   .spendingPlutusScript("V3")
//   .txIn(utxo.input.txHash, utxo.input.outputIndex)
//   .txInInlineDatumPresent()
//   .txInRedeemerValue({ alternative: 0, fields: [] }) // redeemer unused by base
//   .spendingTxInReference(
//     programmableLogicBaseScriptTxHash,
//     programmableLogicBaseScriptIndex
//   )
//   // 2. programmable_logic_global as withdraw-zero
//   .withdrawal(globalRewardAddr, "0")
//   .withdrawalPlutusScriptV3()
//   .withdrawalTxInReference(globalScriptTxHash, globalScriptOutputIndex)
//   .withdrawalRedeemerValue({
//     alternative: 0, // TransferAct
//     fields: [
//       [
//         { alternative: 0, fields: [0] }, // TokenExists, ref input at index 0
//       ],
//     ],
//   })
//   // 3. transfer_logic_script as withdraw-zero
//   .withdrawal(transferLogicRewardAddr, "0")
//   .withdrawalPlutusScriptV3()
//   .withdrawalTxInReference(
//     transferLogicScriptTxHash,
//     transferLogicScriptOutputIndex
//   )
//   .withdrawalRedeemerValue({ alternative: 0, fields: [] }) // depends on substandard
//   // 4. registryNode as reference input (index 0 — matches proof above)
//   .readOnlyTxInReference(registryNodeTxHash, registryNodeOutputIndex)
//   // 5. protocol params as reference input (global validator needs it)
//   .readOnlyTxInReference(protocolParamsTxHash, protocolParamsOutputIndex)
//   // 6. Output to recipient's smart wallet address
//   .txOut(recipientSmartWalletAddr, [
//     { unit: "lovelace", quantity: "2000000" },
//     { unit: tokenPolicyId + tokenAssetName, quantity: "100" },
//   ])
//   // 7. Owner must sign (stake cred ownership check)
//   .requiredSignerHash(userPubKeyHash)
//   .changeAddress(userChangeAddress)
//   .selectUtxosFrom(userWalletUtxos) // for ADA fees
//   .complete();
