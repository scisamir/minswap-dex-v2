import {
    BlockfrostProvider,
    MaestroProvider,
    MeshTxBuilder,
    MeshWallet,
    applyParamsToScript,
    deserializeAddress,
    resolveScriptHash,
    resolveStakeKeyHash,
    serializeNativeScript,
    serializePlutusScript,
    serializeRewardAddress,
} from "@meshsdk/core";
import { builtinByteString, conStr, mConStr0, mPubKeyAddress, NativeScript, outputReference, scriptAddress, scriptHash, ScriptHash, stringToHex, UTxO } from "@meshsdk/common";
import dotenv from "dotenv";
dotenv.config();
import blueprint from "../plutus.json" with { type: "json" };
import utilBlueprint from "./util_contracts/plutus.json" with { type: "json" };
import { OfflineEvaluator, resolveNativeScriptHash } from "@meshsdk/core-csl";
import { SHA3 } from "sha3";

// Setup blockhain provider as Maestro
const maestroKey = process.env.MAESTRO_KEY;
if (!maestroKey) {
    throw new Error("MAESTRO_KEY does not exist");
}
const blockchainProvider = new MaestroProvider({
    network: 'Preview',
    apiKey: maestroKey,
});

// Setup blockhain provider as Blockfrost
// const blockfrostId = process.env.BLOCKFROST_ID;
// if (!blockfrostId) {
//     throw new Error("BLOCKFROST_ID does not exist");
// }
// const blockchainProvider = new BlockfrostProvider(blockfrostId);

// import wallet1's wallet passphrase and initialize the wallet
const wallet1Passphrase = process.env.WALLET_PASSPHRASE_ONE;
if (!wallet1Passphrase) {
    throw new Error("WALLET_PASSPHRASE_ONE does not exist");
}
const wallet1 = new MeshWallet({
    networkId: 0,
    fetcher: blockchainProvider,
    submitter: blockchainProvider,
    key: {
        type: "mnemonic",
        words: wallet1Passphrase.split(' ')
    },
});

const wallet1Address = await wallet1.getChangeAddress();

const wallet1Utxos = await wallet1.getUtxos();
// const wallet1Collateral: UTxO = (await blockchainProvider.fetchUTxOs("cab914aca4fb11f8ed0d736915cc77a756a0b3abd8baebb2a39c734b60849c2e", 2))[0];
const wallet1Collateral: UTxO = (await wallet1.getCollateral())[0]
if (!wallet1Collateral) {
    throw new Error('No collateral utxo found');
}

const { pubKeyHash: wallet1VK, stakeCredentialHash: wallet1SK } = deserializeAddress(wallet1Address);

// Setup wallet2
const wallet2Passphrase = process.env.WALLET_PASSPHRASE_TWO;
if (!wallet2Passphrase) {
    throw new Error("WALLET_PASSPHRASE_TWO does not exist");
}
const wallet2 = new MeshWallet({
    networkId: 0,
    fetcher: blockchainProvider,
    submitter: blockchainProvider,
    key: {
        type: "mnemonic",
        words: wallet2Passphrase.split(' ')
    },
});
const wallet2Address = await wallet2.getChangeAddress();
const { pubKeyHash: wallet2VK } = deserializeAddress(wallet2Address);
const wallet2Utxos = await wallet2.getUtxos();
const wallet2Collateral: UTxO = (await wallet2.getCollateral())[0]
if (!wallet2Collateral) {
    throw new Error('No collateral utxo found');
}

// Setup multisig
const nativeScript: NativeScript = {
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

// Evaluator for Aiken verbose mode
const evaluator = new OfflineEvaluator(blockchainProvider, 'preview');
// Create transaction builder
const txBuilder = new MeshTxBuilder({
    fetcher: blockchainProvider,
    submitter: blockchainProvider,
    evaluator: evaluator, // Can also be "evaluator: blockchainProvider,"
    // evaluator: blockchainProvider,
    // verbose: true,
});
txBuilder.setNetwork('preview');

// constants
const factoryAssetName = "4d5346";
const poolAuthAssetName = "4d5350";
const globalSettingAssetName = "4d534753";

// Utils
const calculateInitialLiquidity = (out_a: number, out_b: number) => {
    let p = out_a * out_b
    let sqrt = Math.floor(Math.sqrt(p)); // mimicking Aiken, because it floors any decimal
    if ((sqrt * sqrt) < p) {
        // console.log("sqrt + 1:", sqrt + 1);
        return (sqrt + 1);
    }
    // console.log("sqrt:", sqrt);
    return sqrt;
}

    // Always true validator
    const cip113Validator = utilBlueprint.validators.filter(v => (
        v.title.includes("cip113.transfer.withdraw") // withdraw 0
    ));
    const cip113ValidatorScript = applyParamsToScript(
        cip113Validator[0].compiledCode,
        [],
        "JSON",
    );
    const cip113ValidatorHash = resolveScriptHash(cip113ValidatorScript, "V3");
const cip113RewardAddress = serializeRewardAddress(
    cip113ValidatorHash,
    true,
    0
);

// User CIP 113 Address
const userCip113Addr = serializePlutusScript(
    { code: cip113ValidatorScript, version: "V3" },
    wallet1VK,
    0
).address;

// Authen Minting Policy
const authenValidator = blueprint.validators.filter(v => (
    v.title.includes("authen_minting_policy.authen_minting_policy.mint")
));
const dexInitParamTxHash = "67eb04953a7a72b6a35989631818bf17f5bb01122a4bbe691381c08b8a2626c4";  // change this and below on each dex init
const dexInitParamTxIndex = 2;
// const dexInitParamTxHash = "af662d8505fe10362f49a89c02c0d190fc6d755481bbf490fd7b798df10ed010";  // change this and below on each dex init
// const dexInitParamTxIndex = 9;
const authenValidatorScript = applyParamsToScript(
    authenValidator[0].compiledCode,
    [outputReference(dexInitParamTxHash, dexInitParamTxIndex)],
    "JSON",
);
const authenPolicyId = resolveScriptHash(authenValidatorScript, "V3");
const authenAddress = serializePlutusScript(
    { code: authenValidatorScript, version: "V3" },
    undefined,
    0,
).address;

// Pool Validator
const poolValidator = blueprint.validators.filter(v => (
    v.title.includes("pool_validator.pool_validator.withdraw") // withdraw 0
));
const poolValidatorScript = applyParamsToScript(
    poolValidator[0].compiledCode,
    [builtinByteString(authenPolicyId)],
    "JSON",
);
const poolStakeCredentialHash = resolveScriptHash(poolValidatorScript, "V3");
const poolValidatorAddress = serializePlutusScript(
    { code: cip113ValidatorScript, version: "V3" },
    poolStakeCredentialHash,
    0,
    true,
).address;
const poolValidatorRewardAddress = serializeRewardAddress(
    poolStakeCredentialHash,
    true,
    0,
);
const poolAddressData = scriptAddress(
    cip113ValidatorHash,
    poolStakeCredentialHash,
    true,
);
const poolValidatorScriptHash = poolStakeCredentialHash;
// console.log("poolValidatorScriptHash:", poolValidatorScriptHash);

// Pool Batching Validator
const poolBatchingValidator = blueprint.validators.filter(v => (
    v.title.includes("pool_validator.pool_batching_validator.withdraw")
));
const poolBatchingValidatorScript = applyParamsToScript(
    poolBatchingValidator[0].compiledCode,
    [builtinByteString(authenPolicyId), poolAddressData],
    "JSON",
);
const poolBatchingValidatorHash = resolveScriptHash(poolBatchingValidatorScript, "V3");
const poolBatchingValidatorRewardAddress = serializeRewardAddress(
    poolBatchingValidatorHash,
    true,
    0,
);
// console.log("poolBatchingValidatorHash:", poolBatchingValidatorHash);

// Factory Validator
const factoryValidator = blueprint.validators.filter(v => (
    v.title.includes("factory_validator.factory_validator.spend")
));
const factoryValidatorScript = applyParamsToScript(
    factoryValidator[0].compiledCode,
    [builtinByteString(authenPolicyId), poolAddressData, conStr(1, [builtinByteString(poolBatchingValidatorHash)])],
    "JSON",
);
const factoryAddress = serializePlutusScript(
    { code: factoryValidatorScript, version: "V3" },
    undefined,
    0,
).address;

// Order Cancellation Validator
const orderCanclValidator = blueprint.validators.filter(v => (
    v.title.includes("order_validator.validate_expired_order_cancel.withdraw")
));
const orderCanclValidatorScript = applyParamsToScript(
    orderCanclValidator[0].compiledCode,
    [],
    "JSON",
);
const orderCanclValidatorHash = resolveScriptHash(orderCanclValidatorScript, "V3");
const orderCanclValidatorRewardAddress = serializeRewardAddress(
    orderCanclValidatorHash,
    true,
    0,
);

// Order Validator
const orderValidator = blueprint.validators.filter(v => (
    v.title.includes("order_validator.order_validator.withdraw")
));
// const orderValidator = utilBlueprint.validators.filter(v => (
//     v.title.includes("always_success_withdraw.always_success.withdraw")
// ));
const orderValidatorScript = applyParamsToScript(
    orderValidator[0].compiledCode,
    [conStr(1, [builtinByteString(poolBatchingValidatorHash)]), conStr(1, [builtinByteString(orderCanclValidatorHash)])],
    "JSON",
);
// const orderValidatorScript = applyParamsToScript(
//     orderValidator[0].compiledCode,
//     [],
//     "JSON",
// );
const orderValidatorScriptHash = resolveScriptHash(orderValidatorScript, "V3");
const orderValidatorAddress = serializePlutusScript(
    { code: cip113ValidatorScript, version: "V3" },
    orderValidatorScriptHash,
    0,
    true,
).address;
const orderValidatorRewardAddress = serializeRewardAddress(
    orderValidatorScriptHash,
    true,
    0,
);
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

console.log("authen validator utxos number:", (await blockchainProvider.fetchAddressUTxOs(authenAddress)).length, '\n');
console.log("factory validator utxos number:", (await blockchainProvider.fetchAddressUTxOs(factoryAddress)).length, '\n');

// test mint
// Always success mint validator
const alwaysSuccessMintValidator = utilBlueprint.validators.filter(v => (
    v.title.includes("placeholder.placeholder.mint")
));
const alwaysSuccessValidatorMintScript = applyParamsToScript(
    alwaysSuccessMintValidator[0].compiledCode,
    [],
    "JSON",
);
const alwaysSuccessMintValidatorHash = resolveScriptHash(alwaysSuccessValidatorMintScript, "V3");

// pool utils
const AdaTokenA = "";
const AdaAssetA = mConStr0([
    "",
    AdaTokenA,
]);

const usdcTokenB = stringToHex("realUSDC");
const usdcUnit = cip113ValidatorHash + usdcTokenB;
const usdcAssetB = mConStr0([
    cip113ValidatorHash,
    usdcTokenB,
]);

const tokenB = stringToHex("myTokenOne");
const assetB = mConStr0([
    alwaysSuccessMintValidatorHash,
    tokenB,
]);

// compute lp asset name
const sha3 = (hex: string): string => {
    const hash = new SHA3(256);
    hash.update(hex, "hex");
    return hash.digest("hex");
  }
const AdaAssetASha256 = sha3("" + AdaTokenA);
const usdcAssetBSha256 = sha3(usdcUnit);
const usdcAdaLpAssetName = sha3(AdaAssetASha256 + usdcAssetBSha256);

const assetBSha256 = sha3(alwaysSuccessMintValidatorHash + tokenB);
const AdaLpAssetName = sha3(AdaAssetASha256 + assetBSha256);

// console.log("alwaysSuccessMintValidatorHash:", alwaysSuccessMintValidatorHash);
// console.log("tokenB:", tokenB);
console.log("usdcAdaLpAssetName:", usdcAdaLpAssetName);
// asset supplies
const AdaTokenSupply = 1500000000;
const myTokenOneSupply = 1500;
const usdcSupply = myTokenOneSupply;
const AdaTotalLiquidity = calculateInitialLiquidity(AdaTokenSupply, myTokenOneSupply);
const maxInt64 = 9223372036854775807n;
const AdaRemainingLiquidity = maxInt64 - (BigInt(AdaTotalLiquidity) - 10n);

// order utils
const swapAmount = 20;
const AdaSwapAmount = 20000000;
const orderLovelaceAmount = 10000000;

// usdc cip113 utxo
const usdcCip113Utxos = await blockchainProvider.fetchUTxOs("67eb04953a7a72b6a35989631818bf17f5bb01122a4bbe691381c08b8a2626c4", 1);
const usdcCip113Utxo = usdcCip113Utxos[0];
if (!usdcCip113Utxo) {
    throw new Error("usdcCip113Utxo not found");
}
const usdcCip113Balance = Number(usdcCip113Utxo.output.amount[1].quantity)
console.log("usdcCip113Balance:", usdcCip113Balance);



// console.log("orderValidatorScriptHash", orderValidatorScriptHash);
// console.log("poolBatchingValidatorHash", poolBatchingValidatorHash);
// console.log("poolValidatorScriptHash", poolValidatorScriptHash);
// console.log("cip113ValidatorHash", cip113ValidatorHash);
// console.log("orderValidatorAddress:", orderValidatorAddress);
// console.log("alwaysSuccessMintValidatorHash:", alwaysSuccessMintValidatorHash);
// console.log("userCip113Addr:", userCip113Addr);

// console.log("wallet1VK:", wallet1VK);

export {
    blueprint,
    blockchainProvider,
    txBuilder,
    // wallet1
    wallet1,
    wallet1Address,
    wallet1VK,
    wallet1SK,
    wallet1Utxos,
    wallet1Collateral,
    userCip113Addr,
    // wallet 2
    wallet2,
    wallet2Collateral,
    wallet2Utxos,
    wallet2Address,
    wallet2VK,
    // multisig
    multisigHash,
    multiSigAddress,
    // authen
    authenValidatorScript,
    authenPolicyId,
    authenAddress,
    dexInitParamTxHash,
    dexInitParamTxIndex,
    // factory
    factoryValidatorScript,
    factoryAddress,
    // order
    orderValidatorScript,
    orderValidatorAddress,
    orderValidatorRewardAddress,
    orderValidatorScriptHash,
    // order cancellation validator
    orderCanclValidatorScript,
    orderCanclValidatorRewardAddress,
    // pool
    poolValidatorAddress,
    poolValidatorRewardAddress,
    poolValidatorScript,
    poolValidatorScriptHash,
    // pool batching
    poolBatchingValidatorHash,
    poolBatchingValidatorRewardAddress,
    poolBatchingValidatorScript,
    // cip 113
    cip113Validator,
    cip113ValidatorScript,
    cip113ValidatorHash,
    cip113RewardAddress,
    usdcTokenB,
    usdcAssetB,
    usdcAdaLpAssetName,
    usdcUnit,
    usdcSupply,
    usdcCip113Utxo,
    usdcCip113Balance,
    // always success mint
    alwaysSuccessValidatorMintScript,
    alwaysSuccessMintValidatorHash,
    // constants
    factoryAssetName,
    poolAuthAssetName,
    globalSettingAssetName,
    // Utils
    calculateInitialLiquidity,
    // pool utils
    tokenB,
    assetB,
    myTokenOneSupply,
    maxInt64,
    // order utils
    swapAmount,
    orderLovelaceAmount,
    // for ADA
    AdaTokenA,
    AdaAssetA,
    AdaTokenSupply,
    AdaSwapAmount,
    AdaLpAssetName,
    AdaRemainingLiquidity,
    AdaTotalLiquidity,
}
