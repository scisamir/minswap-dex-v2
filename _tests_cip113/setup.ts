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
  builtinByteString,
  conStr,
  mConStr0,
  mPubKeyAddress,
  NativeScript,
  outputReference,
  scriptAddress,
  scriptHash,
  ScriptHash,
  stringToHex,
  UTxO,
  resolveNativeScriptHash,
} from "@meshsdk/core";
import dotenv from "dotenv";
dotenv.config();
import blueprint from "../plutus.json" with { type: "json" };
import utilBlueprint from "./util_contracts/plutus.json" with { type: "json" };
import { SHA3 } from "sha3";

const NETWORK_ID = 0;

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
// console.log("wallet1Address:", wallet1Address);
// console.log("wallet1Utxos:", wallet1Utxos);
const wallet1Collateral: UTxO = wallet1Utxos.filter(
  (utxo) =>
    Number(utxo.output.amount[0].quantity) >= 7000000 &&
    utxo.output.amount.length === 1
)[0];
if (!wallet1Collateral) {
  throw new Error("No collateral utxo found 1");
}

const { pubKeyHash: wallet1VK, stakeCredentialHash: wallet1SK } =
  deserializeAddress(wallet1Address);

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
const wallet2Collateral: UTxO = wallet2Utxos.filter(
  (utxo) =>
    Number(utxo.output.amount[0].quantity) >= 7000000 &&
    utxo.output.amount.length <= 4
)[0];
if (!wallet2Collateral) {
  throw new Error("No collateral utxo found 2");
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
const { address: multiSigAddress, scriptCbor: multiSigCbor } =
  serializeNativeScript(nativeScript);
const multisigHash = resolveNativeScriptHash(nativeScript);

// Create transaction builder
const txBuilder = new MeshTxBuilder({
  fetcher: blockchainProvider,
  submitter: blockchainProvider,
  // evaluator: evaluator, // Can also be "evaluator: blockchainProvider,"
  evaluator: blockchainProvider,
  //   verbose: true,
});
txBuilder.setNetwork("preview");

// constants
const factoryAssetName = "4d5346";
const poolAuthAssetName = "4d5350";
const globalSettingAssetName = "4d534753";

// Utils
const calculateInitialLiquidity = (out_a: number, out_b: number) => {
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
const cip113Validator = utilBlueprint.validators.filter(
  (v) => v.title.includes("cip113.transfer.withdraw") // withdraw 0
);
const cip113ValidatorScript = applyParamsToScript(
  cip113Validator[0].compiledCode,
  [],
  "JSON"
);
const cip113ValidatorHash = resolveScriptHash(cip113ValidatorScript, "V3");
const cip113RewardAddress = serializeRewardAddress(
  cip113ValidatorHash,
  true,
  NETWORK_ID
);

// User CIP 113 Address
const userCip113Addr = serializePlutusScript(
  { code: cip113ValidatorScript, version: "V3" },
  wallet1VK,
  NETWORK_ID
).address;

// Authen Minting Policy
const authenValidator = blueprint.validators.filter((v) =>
  v.title.includes("authen_minting_policy.authen_minting_policy.mint")
);
// (Mainnet)
const dexInitParamTxHash =
  "fe4e4783114376697bf8f752262b448fbe3490ce3bea0be98a6f8e33c282cd29"; // change this and below on each dex init
const dexInitParamTxIndex = 1;
// (Preprod)
// const dexInitParamTxHash =
//   "e68b7a3d147090a551fb62d979d647c364dda41ce3ad511083d66bdb35b2176b"; // change this and below on each dex init
// const dexInitParamTxIndex = 1;
const authenValidatorScript = applyParamsToScript(
  authenValidator[0].compiledCode,
  [outputReference(dexInitParamTxHash, dexInitParamTxIndex)],
  "JSON"
);
const authenPolicyId = resolveScriptHash(authenValidatorScript, "V3");
const authenAddress = serializePlutusScript(
  { code: authenValidatorScript, version: "V3" },
  undefined,
  NETWORK_ID
).address;

// Pool Validator
const poolValidator = blueprint.validators.filter(
  (v) => v.title.includes("pool_validator.pool_validator.withdraw") // withdraw 0
);
const poolValidatorScript = applyParamsToScript(
  poolValidator[0].compiledCode,
  [builtinByteString(authenPolicyId)],
  "JSON"
);
const poolStakeCredentialHash = resolveScriptHash(poolValidatorScript, "V3");
const poolValidatorAddress = serializePlutusScript(
  { code: cip113ValidatorScript, version: "V3" },
  poolStakeCredentialHash,
  NETWORK_ID,
  true
).address;
const poolValidatorRewardAddress = serializeRewardAddress(
  poolStakeCredentialHash,
  true,
  NETWORK_ID
);
const poolAddressData = scriptAddress(
  cip113ValidatorHash,
  poolStakeCredentialHash,
  true
);
const poolValidatorScriptHash = poolStakeCredentialHash;
// console.log("poolValidatorScriptHash:", poolValidatorScriptHash);

// Pool Batching Validator
const poolBatchingValidator = blueprint.validators.filter((v) =>
  v.title.includes("pool_validator.pool_batching_validator.withdraw")
);
const poolBatchingValidatorScript = applyParamsToScript(
  poolBatchingValidator[0].compiledCode,
  [builtinByteString(authenPolicyId), poolAddressData],
  "JSON"
);
const poolBatchingValidatorHash = resolveScriptHash(
  poolBatchingValidatorScript,
  "V3"
);
const poolBatchingValidatorRewardAddress = serializeRewardAddress(
  poolBatchingValidatorHash,
  true,
  NETWORK_ID
);
// console.log("poolBatchingValidatorHash:", poolBatchingValidatorHash);

// Factory Validator
const factoryValidator = blueprint.validators.filter((v) =>
  v.title.includes("factory_validator.factory_validator.spend")
);
const factoryValidatorScript = applyParamsToScript(
  factoryValidator[0].compiledCode,
  [
    builtinByteString(authenPolicyId),
    poolAddressData,
    conStr(1, [builtinByteString(poolBatchingValidatorHash)]),
  ],
  "JSON"
);
const factoryAddress = serializePlutusScript(
  { code: factoryValidatorScript, version: "V3" },
  undefined,
  NETWORK_ID
).address;

// Order Cancellation Validator
const orderCanclValidator = blueprint.validators.filter((v) =>
  v.title.includes("order_validator.validate_expired_order_cancel.withdraw")
);
const orderCanclValidatorScript = applyParamsToScript(
  orderCanclValidator[0].compiledCode,
  [],
  "JSON"
);
const orderCanclValidatorHash = resolveScriptHash(
  orderCanclValidatorScript,
  "V3"
);
const orderCanclValidatorRewardAddress = serializeRewardAddress(
  orderCanclValidatorHash,
  true,
  NETWORK_ID
);

// Order Validator
const orderValidator = blueprint.validators.filter((v) =>
  v.title.includes("order_validator.order_validator.withdraw")
);
// const orderValidator = utilBlueprint.validators.filter(v => (
//     v.title.includes("always_success_withdraw.always_success.withdraw")
// ));
const orderValidatorScript = applyParamsToScript(
  orderValidator[0].compiledCode,
  [
    conStr(1, [builtinByteString(poolBatchingValidatorHash)]),
    conStr(1, [builtinByteString(orderCanclValidatorHash)]),
  ],
  "JSON"
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
  NETWORK_ID,
  true
).address;
const orderValidatorRewardAddress = serializeRewardAddress(
  orderValidatorScriptHash,
  true,
  NETWORK_ID
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

console.log(
  "authen validator utxos number:",
  (await blockchainProvider.fetchAddressUTxOs(authenAddress)).length,
  "\n"
);
console.log(
  "factory validator utxos number:",
  (await blockchainProvider.fetchAddressUTxOs(factoryAddress)).length,
  "\n"
);

// test mint
// Always success mint validator
const alwaysSuccessMintValidator = utilBlueprint.validators.filter((v) =>
  v.title.includes("placeholder.placeholder.mint")
);
const alwaysSuccessValidatorMintScript = applyParamsToScript(
  alwaysSuccessMintValidator[0].compiledCode,
  [],
  "JSON"
);
const alwaysSuccessMintValidatorHash = resolveScriptHash(
  alwaysSuccessValidatorMintScript,
  "V3"
);

// pool utils
const AdaTokenA = "";
const AdaAssetA = mConStr0(["", AdaTokenA]);

const usdcTokenB = stringToHex("realUSDC");
const usdcUnit = cip113ValidatorHash + usdcTokenB;
const usdcAssetB = mConStr0([cip113ValidatorHash, usdcTokenB]);

const tokenB = stringToHex("myTokenOne");
const assetB = mConStr0([alwaysSuccessMintValidatorHash, tokenB]);

// compute lp asset name
const sha3 = (hex: string): string => {
  const hash = new SHA3(256);
  hash.update(hex, "hex");
  return hash.digest("hex");
};
const AdaAssetASha256 = sha3("" + AdaTokenA);
const usdcAssetBSha256 = sha3(usdcUnit);
const usdcAdaLpAssetName = sha3(AdaAssetASha256 + usdcAssetBSha256);

const assetBSha256 = sha3(alwaysSuccessMintValidatorHash + tokenB);
const AdaLpAssetName = sha3(AdaAssetASha256 + assetBSha256);

// console.log("alwaysSuccessMintValidatorHash:", alwaysSuccessMintValidatorHash);
// console.log("tokenB:", tokenB);
console.log("usdcAdaLpAssetName:", usdcAdaLpAssetName);
// asset supplies
// const AdaTokenSupply = 1500000000;
// const myTokenOneSupply = 1500;
const AdaTokenSupply = 15000000;
const myTokenOneSupply = 15;
const usdcSupply = myTokenOneSupply;
const AdaTotalLiquidity = calculateInitialLiquidity(
  AdaTokenSupply,
  myTokenOneSupply
);
const maxInt64 = 9223372036854775807n;
const AdaRemainingLiquidity = maxInt64 - (BigInt(AdaTotalLiquidity) - 10n);

// order utils
const swapAmount = 5;
const AdaSwapAmount = 2000000;
const orderLovelaceAmount = 5300000;

// usdc cip113 utxo
const usdcCip113Utxos = wallet1Utxos;
// const usdcCip113Utxos = await blockchainProvider.fetchUTxOs(
//   "2dafc93d572ea568ca80dcdc4f73352c36e34868aaaa716e16e2b44b6d173e48",
//   2
// );
const usdcCip113Utxo = usdcCip113Utxos[0];
if (!usdcCip113Utxo) {
  throw new Error("usdcCip113Utxo not found");
}
const usdcCip113Balance = Number(usdcCip113Utxo.output.amount[0].quantity);
// const usdcCip113Balance = Number(usdcCip113Utxo.output.amount[1].quantity);
console.log("usdcCip113Balance:", usdcCip113Balance);

// console.log("orderValidatorScriptHash", orderValidatorScriptHash);
// console.log("poolBatchingValidatorHash", poolBatchingValidatorHash);
// console.log("poolValidatorScriptHash", poolValidatorScriptHash);
// console.log("cip113ValidatorHash", cip113ValidatorHash);
// console.log("orderValidatorAddress:", orderValidatorAddress);
// console.log("alwaysSuccessMintValidatorHash:", alwaysSuccessMintValidatorHash);
// console.log("userCip113Addr:", userCip113Addr);
console.log("authenPolicyId:", authenPolicyId);

// console.log("wallet1VK:", wallet1VK);

const lorenzoAddress =
  "addr_test1qqq0cuu96g9hny47un2qcyv7qcs3u70whcdmf06mqj3pkt4wckwszdqepz35tf5h4h9mkce2p4hf3wj239pwhxswwkcq7p5gst";
const { pubKeyHash: lorenzoVK } = deserializeAddress(lorenzoAddress);
const lorenzoSmartAddr = serializePlutusScript(
  { code: cip113ValidatorScript, version: "V3" },
  lorenzoVK,
  NETWORK_ID
).address;

console.log(cip113ValidatorHash, lorenzoVK);

const calculate_amount_out = (
  reserve_in: number,
  reserve_out: number,
  amount_in: number,
  trading_fee_numerator: number
) => {
  const default_fee_denominator = 10000;

  let diff = default_fee_denominator - trading_fee_numerator;
  let in_with_fee = diff * amount_in;
  let numerator = in_with_fee * reserve_out;
  let denominator = default_fee_denominator * reserve_in + in_with_fee;
  return Math.floor(numerator / denominator);
};

// -------------Working hashes---------------- (Preview)
// pool batching ref script
// const poolBatchingScriptTxHash = "85e83c7cab230207f913245a43c9c25efaa9124a69e6116cb2bb6d966364ab2a";
// const poolBatchingScriptTxIndex = 0;
// // pool ref script
// const poolScriptTxHash = "7f3ae62c327604df8689f53ba4079f4c42e5c5dc8754c2dd27172d1d124f7f4b";
// const poolScriptTxIndex = 0;
// // order ref script
// const orderScriptTxHash = "c5291bac8918c4067783388da62e1d68c8fb8cd75fe50dc71a74bcb8e3caae7b";
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
const poolBatchingScriptTxHash =
  "c3e7559ed8c00d25ccaff20b485dd4573843070ae96b25d2ce2b0b65c8c03d8c";
const poolBatchingScriptTxIndex = 0;
// pool ref script
const poolScriptTxHash =
  "47e405c8fe12fa891b01497658796be1317dea037647f4361daca39a7f33db82";
const poolScriptTxIndex = 0;
// order ref script
const orderScriptTxHash =
  "271af0b304ec2cac2e02f96d0557a71f529a087e8aeb2a22b35ec53256dd366a";
const orderScriptTxIndex = 0;

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
  // others
  lorenzoVK,
  lorenzoSmartAddr,
  NETWORK_ID,
  calculate_amount_out,
  // reference inputs
  poolBatchingScriptTxHash,
  poolBatchingScriptTxIndex,
  poolScriptTxHash,
  poolScriptTxIndex,
  orderScriptTxHash,
  orderScriptTxIndex,
};
