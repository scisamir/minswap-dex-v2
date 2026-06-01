import { BlockfrostProvider, MeshTxBuilder, MeshWallet, applyParamsToScript, deserializeAddress, resolveScriptHash, serializeNativeScript, serializePlutusScript, serializeRewardAddress, builtinByteString, conStr, mConStr0, outputReference, scriptAddress, resolveNativeScriptHash, } from "@meshsdk/core";
import { OfflineEvaluatorScalus } from "@meshsdk/core-cst";
import dotenv from "dotenv";
dotenv.config();
import blueprint from "../plutus.json" with { type: "json" };
import utilBlueprint from "./util_contracts/plutus.json" with { type: "json" };
import cip113Blueprint from "../cip113-programmable-tokens/plutus.json" with { type: "json" };
import purrfluidProtocolBootstrap from "./purrfluid/protocolBoostrap.json" with { type: "json" };
const NETWORK_ID = 1;
// Setup blockhain provider as Maestro
// const maestroKey = process.env.MAESTRO_KEY;
// if (!maestroKey) {
//   throw new Error("MAESTRO_KEY does not exist");
// }
// const blockchainProvider = new MaestroProvider({
//   network: "Preview",
//   apiKey: maestroKey,
// });
// Setup blockhain provider as Blockfrost
const blockfrostId = process.env.BLOCKFROST_ID;
if (!blockfrostId) {
    throw new Error("BLOCKFROST_ID does not exist");
}
const blockchainProvider = new BlockfrostProvider(blockfrostId);
// import wallet1's wallet passphrase and initialize the wallet
const wallet1Passphrase = process.env.WALLET_PASSPHRASE_ONE;
if (!wallet1Passphrase) {
    throw new Error("WALLET_PASSPHRASE_ONE does not exist");
}
const wallet1 = new MeshWallet({
    networkId: NETWORK_ID,
    fetcher: blockchainProvider,
    submitter: blockchainProvider,
    key: {
        type: "mnemonic",
        words: wallet1Passphrase.split(" "),
    },
});
const wallet1Address = await wallet1.getChangeAddress();
const wallet1Utxos = await wallet1.getUtxos();
console.log("wallet1Address:", wallet1Address);
// console.log("wallet1Utxos:", wallet1Utxos);
const wallet1Collateral = wallet1Utxos.filter((utxo) => Number(utxo.output.amount[0].quantity) >= 7000000 &&
    utxo.output.amount.length === 1)[0];
if (!wallet1Collateral) {
    throw new Error("No collateral utxo found 1");
}
const { pubKeyHash: wallet1VK, stakeCredentialHash: wallet1SK } = deserializeAddress(wallet1Address);
// Setup wallet2
const wallet2Passphrase = process.env.WALLET_PASSPHRASE_TWO;
if (!wallet2Passphrase) {
    throw new Error("WALLET_PASSPHRASE_TWO does not exist");
}
const wallet2 = new MeshWallet({
    networkId: NETWORK_ID,
    fetcher: blockchainProvider,
    submitter: blockchainProvider,
    key: {
        type: "mnemonic",
        words: wallet2Passphrase.split(" "),
    },
});
const wallet2Address = await wallet2.getChangeAddress();
const { pubKeyHash: wallet2VK } = deserializeAddress(wallet2Address);
const wallet2Utxos = await wallet2.getUtxos();
// const wallet2Collateral: UTxO = wallet2Utxos.filter(
//   (utxo) =>
//     Number(utxo.output.amount[0].quantity) >= 7000000 &&
//     utxo.output.amount.length === 1
// )[0];
// if (!wallet2Collateral) {
//   throw new Error("No collateral utxo found 2");
// }
console.log("wallet1 vk:", wallet1VK);
// Setup multisig
const nativeScript = {
    type: "all",
    scripts: [
        {
            type: "sig",
            keyHash: wallet1VK,
        },
        {
            type: "sig",
            keyHash: wallet2VK,
        },
    ],
};
const { address: multiSigAddress, scriptCbor: multiSigCbor } = serializeNativeScript(nativeScript);
const multisigHash = resolveNativeScriptHash(nativeScript);
// Create transaction builder
const txEvaluator = process.env.OFFLINE_EVAL === "1"
    ? new OfflineEvaluatorScalus(blockchainProvider, "mainnet")
    : blockchainProvider;
const txBuilder = new MeshTxBuilder({
    fetcher: blockchainProvider,
    submitter: blockchainProvider,
    evaluator: txEvaluator,
    //   verbose: true,
});
txBuilder.setNetwork("mainnet");
// constants
const factoryAssetName = "4d5346";
const poolAuthAssetName = "4d5350";
const globalSettingAssetName = "4d534753";
// Utils
const calculateInitialLiquidity = (out_a, out_b) => {
    let p = out_a * out_b;
    let sqrt = Math.floor(Math.sqrt(p)); // mimicking Aiken, because it floors any decimal
    if (sqrt * sqrt < p) {
        // console.log("sqrt + 1:", sqrt + 1);
        return sqrt + 1;
    }
    // console.log("sqrt:", sqrt);
    return sqrt;
};
// Always true validator
// const cip113Validator = utilBlueprint.validators.filter(
//   (v) => v.title.includes("cip113.transfer.withdraw") // withdraw 0
// );
// const cip113ValidatorScript = applyParamsToScript(
//   cip113Validator[0].compiledCode,
//   [],
//   "JSON"
// );
// const cip113ValidatorHash = resolveScriptHash(cip113ValidatorScript, "V3");
// const cip113RewardAddress = serializeRewardAddress(
//   cip113ValidatorHash,
//   true,
//   NETWORK_ID
// );
const programmableGlobalHash = purrfluidProtocolBootstrap.programmableLogicGlobalPrams.scriptHash;
const programmableBaseValidator = cip113Blueprint.validators.find((v) => v.title === "programmable_logic_base.programmable_logic_base.spend");
if (!programmableBaseValidator) {
    throw new Error("programmable logic base validator not found");
}
const baseScript = applyParamsToScript(programmableBaseValidator.compiledCode, [conStr(1, [builtinByteString(programmableGlobalHash)])], "JSON");
const baseHash = resolveScriptHash(baseScript, "V3");
if (baseHash !== purrfluidProtocolBootstrap.programmableLogicBaseParams.scriptHash) {
    throw new Error(`PurrFluid base hash mismatch: derived ${baseHash}, deployed ${purrfluidProtocolBootstrap.programmableLogicBaseParams.scriptHash}`);
}
// Authen Minting Policy
const authenValidator = blueprint.validators.filter((v) => v.title.includes("authen_minting_policy.authen_minting_policy.mint"));
// (Mainnet)
const dexInitParamTxHash = "ea214c622c0ac93d040b4501f84596580f7eb0e977e6dd5ba4aaedb37eef3b04"; // change this and below on each dex init
const dexInitParamTxIndex = 2;
// (Preprod)
// const dexInitParamTxHash =
//   "e68b7a3d147090a551fb62d979d647c364dda41ce3ad511083d66bdb35b2176b"; // change this and below on each dex init
// const dexInitParamTxIndex = 1;
// (Preview)
// const dexInitParamTxHash =
//   "5cf28413764400694902c4d08f2970741ca8e344476f36dda667b9d00ac7d1c3"; // change this and below on each dex init
// const dexInitParamTxIndex = 3;
const authenValidatorScript = applyParamsToScript(authenValidator[0].compiledCode, [outputReference(dexInitParamTxHash, dexInitParamTxIndex)], "JSON");
const authenPolicyId = resolveScriptHash(authenValidatorScript, "V3");
const authenAddress = serializePlutusScript({ code: authenValidatorScript, version: "V3" }, undefined, NETWORK_ID).address;
// Pool Validator
const poolValidator = blueprint.validators.filter((v) => v.title.includes("pool_validator.pool_validator.withdraw") // withdraw 0
);
const poolValidatorScript = applyParamsToScript(poolValidator[0].compiledCode, [builtinByteString(authenPolicyId)], "JSON");
const poolStakeCredentialHash = resolveScriptHash(poolValidatorScript, "V3");
const poolValidatorAddress = serializePlutusScript({ code: baseScript, version: "V3" }, poolStakeCredentialHash, NETWORK_ID, true).address;
const poolValidatorRewardAddress = serializeRewardAddress(poolStakeCredentialHash, true, NETWORK_ID);
const poolAddressData = scriptAddress(baseHash, poolStakeCredentialHash, true);
const poolValidatorScriptHash = poolStakeCredentialHash;
// console.log("poolValidatorScriptHash:", poolValidatorScriptHash);
// Pool Batching Validator
const poolBatchingValidator = blueprint.validators.filter((v) => v.title.includes("pool_validator.pool_batching_validator.withdraw"));
const poolBatchingValidatorScript = applyParamsToScript(poolBatchingValidator[0].compiledCode, [builtinByteString(authenPolicyId), poolAddressData], "JSON");
const poolBatchingValidatorHash = resolveScriptHash(poolBatchingValidatorScript, "V3");
const poolBatchingValidatorRewardAddress = serializeRewardAddress(poolBatchingValidatorHash, true, NETWORK_ID);
// console.log("poolBatchingValidatorHash:", poolBatchingValidatorHash);
// Factory Validator
const factoryValidator = blueprint.validators.filter((v) => v.title.includes("factory_validator.factory_validator.spend"));
const factoryValidatorScript = applyParamsToScript(factoryValidator[0].compiledCode, [
    builtinByteString(authenPolicyId),
    poolAddressData,
    conStr(1, [builtinByteString(poolBatchingValidatorHash)]),
], "JSON");
const factoryAddress = serializePlutusScript({ code: factoryValidatorScript, version: "V3" }, undefined, NETWORK_ID).address;
// Order Cancellation Validator
const orderCanclValidator = blueprint.validators.filter((v) => v.title.includes("order_validator.validate_expired_order_cancel.withdraw"));
const orderCanclValidatorScript = applyParamsToScript(orderCanclValidator[0].compiledCode, [], "JSON");
const orderCanclValidatorHash = resolveScriptHash(orderCanclValidatorScript, "V3");
const orderCanclValidatorRewardAddress = serializeRewardAddress(orderCanclValidatorHash, true, NETWORK_ID);
// Order Validator
const orderValidator = blueprint.validators.filter((v) => v.title.includes("order_validator.order_validator.withdraw"));
const orderValidatorScript = applyParamsToScript(orderValidator[0].compiledCode, [
    conStr(1, [builtinByteString(poolBatchingValidatorHash)]),
    conStr(1, [builtinByteString(orderCanclValidatorHash)]),
], "JSON");
const orderValidatorScriptHash = resolveScriptHash(orderValidatorScript, "V3");
const orderValidatorAddress = serializePlutusScript({ code: baseScript, version: "V3" }, orderValidatorScriptHash, NETWORK_ID, true).address;
const orderValidatorRewardAddress = serializeRewardAddress(orderValidatorScriptHash, true, NETWORK_ID);
// User CIP 113 Address
const userCip113Addr = serializePlutusScript({ code: baseScript, version: "V3" }, wallet1VK, NETWORK_ID, false).address;
// console.log("orderValidatorScriptHash:", orderValidatorScriptHash);
// console.log('orderValidator Reward Address:', orderValidatorRewardAddress);
// tests
// console.log("orderValidatorScriptHash:", orderValidatorScriptHash);
// const { pubKeyHash: orderVK, stakeCredentialHash: orderSK, scriptHash: orderScH, stakeScriptCredentialHash: orderStakeScH  } = deserializeAddress(orderValidatorAddress);
// console.log("orderVK:", orderVK);
// console.log("orderSK:", orderSK);
// console.log("orderScH:", orderScH);
// console.log("orderStakeScH:", orderStakeScH);
// console.log("mPubKeyAddress(wallet1VK, wallet1SK):", mPubKeyAddress(wallet1VK, wallet1SK));
// console.log("poolAddressData:", poolAddressData);
console.log("authen validator utxos number:", (await blockchainProvider.fetchAddressUTxOs(authenAddress)).length, "\n");
console.log("factory validator utxos number:", (await blockchainProvider.fetchAddressUTxOs(factoryAddress)).length, "\n");
// test mint
// Always success mint validator
const alwaysSuccessMintValidator = utilBlueprint.validators.filter((v) => v.title.includes("placeholder.placeholder.mint"));
const alwaysSuccessValidatorMintScript = applyParamsToScript(alwaysSuccessMintValidator[0].compiledCode, [], "JSON");
const alwaysSuccessMintValidatorHash = resolveScriptHash(alwaysSuccessValidatorMintScript, "V3");
// pool utils
const AdaTokenA = "";
const AdaAssetA = mConStr0(["", AdaTokenA]);
// asset supplies
const AdaTokenSupply = 50000000;
const purrfluidPoolSupply = 1500;
// const AdaTokenSupply = 15000000;
// const purrfluidPoolSupply = 15;
const AdaTotalLiquidity = calculateInitialLiquidity(AdaTokenSupply, purrfluidPoolSupply);
const maxInt64 = 9223372036854775807n;
const AdaRemainingLiquidity = maxInt64 - (BigInt(AdaTotalLiquidity) - 10n);
// order utils
const swapAmount = 5;
const AdaSwapAmount = 2000000;
const orderLovelaceAmount = 5300000;
console.log("userCip113Addr:", userCip113Addr);
// console.log("orderValidatorScriptHash", orderValidatorScriptHash);
// console.log("poolBatchingValidatorHash", poolBatchingValidatorHash);
// console.log("poolValidatorScriptHash", poolValidatorScriptHash);
// console.log("cip113ValidatorHash", cip113ValidatorHash);
// console.log("orderValidatorAddress:", orderValidatorAddress);
// console.log("alwaysSuccessMintValidatorHash:", alwaysSuccessMintValidatorHash);
// console.log("userCip113Addr:", userCip113Addr);
console.log("authenPolicyId:", authenPolicyId);
// console.log("wallet1VK:", wallet1VK);
const lorenzoAddress = "addr1q89h2jxj8wr7u0hw7fdv55v5q8evav05p4tcrheavldr77sv2rhpkt2v62f7e48xz6v4vyes93sfnp3q9p6qxmszghjqj6n8h6";
const { pubKeyHash: lorenzoVK } = deserializeAddress(lorenzoAddress);
const lorenzoSmartAddr = serializePlutusScript({ code: baseScript, version: "V3" }, lorenzoVK, NETWORK_ID).address;
console.log("LorenzoVK:", lorenzoVK);
const calculate_amount_out = (reserve_in, reserve_out, amount_in, trading_fee_numerator) => {
    const default_fee_denominator = 10000;
    let diff = default_fee_denominator - trading_fee_numerator;
    let in_with_fee = diff * amount_in;
    let numerator = in_with_fee * reserve_out;
    let denominator = default_fee_denominator * reserve_in + in_with_fee;
    return Math.floor(numerator / denominator);
};
// -------------Working hashes---------------- (Preview)
// pool batching ref script
// const poolBatchingScriptTxHash =
//   "133b0c2b754b224f4f6ffff614f631a902aee8c6d10557128c1a7132ead0c5a8";
// const poolBatchingScriptTxIndex = 0;
// // pool ref script
// const poolScriptTxHash =
//   "8d8980e933d52d9eda98a4efcfee564a9c7e40e59530394a75e6cb05c586bb8b";
// const poolScriptTxIndex = 0;
// // order ref script
// const orderScriptTxHash =
//   "45b01e5ac0e5788b1c9d8389da345e252b9e5c26e39a68d5d6360d4e61db9bbb";
// const orderScriptTxIndex = 0;
// -------------Working hashes---------------- (Preprod)
// pool batching ref script
// const poolBatchingScriptTxHash =
//   "884ff2c9578f34d657566349b1e99b1c9c407c09e45118d1e13efdf84be4775e";
// const poolBatchingScriptTxIndex = 0;
// // pool ref script
// const poolScriptTxHash =
//   "ffdaec94caa9d50bdc06ce620a35f2ab68519714cdc76ada7c8088d571bb734a";
// const poolScriptTxIndex = 0;
// // order ref script
// const orderScriptTxHash =
//   "c0ccd1e23f98adb2e7797c5c2232af59df6e16813cf8de3882d60bda6fb8e486";
// const orderScriptTxIndex = 0;
// -------------Working hashes---------------- (Mainnet)
// pool batching ref script
const poolBatchingScriptTxHash = "fd0cccb4e0fec4da7e37fbb95ede1a3e5781f85b67995e4f62d5fdd61cb51534";
const poolBatchingScriptTxIndex = 0;
// pool ref script
const poolScriptTxHash = "866d146132dd5745aaa12ca0ce63ec28248984b7fcd5a76301f8b8146c8d81bd";
const poolScriptTxIndex = 0;
// order ref script
const orderScriptTxHash = "8e5b1fda76a15e987ab9ddbdae08e760b20500fd80a50003198042f991343cd3";
const orderScriptTxIndex = 0;
export { blueprint, blockchainProvider, txBuilder, 
// wallet1
wallet1, wallet1Address, wallet1VK, wallet1SK, wallet1Utxos, wallet1Collateral, userCip113Addr, 
// wallet 2
wallet2, 
// wallet2Collateral,
wallet2Utxos, wallet2Address, wallet2VK, 
// multisig
multisigHash, multiSigAddress, 
// authen
authenValidatorScript, authenPolicyId, authenAddress, dexInitParamTxHash, dexInitParamTxIndex, 
// factory
factoryValidatorScript, factoryAddress, 
// order
orderValidatorScript, orderValidatorAddress, orderValidatorRewardAddress, orderValidatorScriptHash, 
// order cancellation validator
orderCanclValidatorScript, orderCanclValidatorRewardAddress, 
// pool
poolValidatorAddress, poolValidatorRewardAddress, poolValidatorScript, poolValidatorScriptHash, 
// pool batching
poolBatchingValidatorHash, poolBatchingValidatorRewardAddress, poolBatchingValidatorScript, 
// cip 113
programmableBaseValidator, baseScript, baseHash, 
// baseRewardAddress,
// always success mint
alwaysSuccessValidatorMintScript, alwaysSuccessMintValidatorHash, 
// constants
factoryAssetName, poolAuthAssetName, globalSettingAssetName, 
// Utils
calculateInitialLiquidity, 
// pool utils
purrfluidPoolSupply, maxInt64, 
// order utils
swapAmount, orderLovelaceAmount, 
// for ADA
AdaTokenA, AdaAssetA, AdaTokenSupply, AdaSwapAmount, AdaRemainingLiquidity, AdaTotalLiquidity, 
// others
lorenzoVK, lorenzoSmartAddr, NETWORK_ID, calculate_amount_out, 
// reference inputs
poolBatchingScriptTxHash, poolBatchingScriptTxIndex, poolScriptTxHash, poolScriptTxIndex, orderScriptTxHash, orderScriptTxIndex, };
