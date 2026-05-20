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
import programmableTokensBlueprint from "./programmableTokens/blueprint.json" with { type: "json" };
import { SHA3 } from "sha3";

const NETWORK_ID = 0;

// Setup blockhain provider as Maestro
const maestroKey = process.env.MAESTRO_KEY;
if (!maestroKey) {
  throw new Error("MAESTRO_KEY does not exist");
}
const blockchainProvider = new MaestroProvider({
  network: "Preview",
  apiKey: maestroKey,
});

// Setup blockhain provider as Blockfrost
// const blockfrostId = process.env.BLOCKFROST_ID;
// if (!blockfrostId) {
//   throw new Error("BLOCKFROST_ID does not exist");
// }
// const blockchainProvider = new BlockfrostProvider(blockfrostId);

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
    utxo.output.amount.length === 1
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

const programmableGlobalHash =
  "5db48c6383a98a53ca163e58c0f8c9dbc932d65ba070daff97851282";
const programmableBaseValidator = programmableTokensBlueprint.validators.find(
  (v) => v.title === "programmable_logic_base.programmable_logic_base.spend"
);
if (!programmableBaseValidator) {
  throw new Error("programmable logic base validator not found");
}
const baseScript = applyParamsToScript(
  programmableBaseValidator.compiledCode,
  [conStr(1, [builtinByteString(programmableGlobalHash)])],
  "JSON"
);
const baseHash = resolveScriptHash(baseScript, "V3");

// Authen Minting Policy
const authenValidator = blueprint.validators.filter((v) =>
  v.title.includes("authen_minting_policy.authen_minting_policy.mint")
);
// (Mainnet)
// const dexInitParamTxHash =
//   "fe4e4783114376697bf8f752262b448fbe3490ce3bea0be98a6f8e33c282cd29"; // change this and below on each dex init
// const dexInitParamTxIndex = 1;
// (Preprod)
// const dexInitParamTxHash =
//   "e68b7a3d147090a551fb62d979d647c364dda41ce3ad511083d66bdb35b2176b"; // change this and below on each dex init
// const dexInitParamTxIndex = 1;
// (Preview)
const dexInitParamTxHash =
  "d5cd7169ad7adc2fba17894ce0531be54d9e8908b2904fb484bce8577bcbd893"; // change this and below on each dex init
const dexInitParamTxIndex = 3;
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
  { code: baseScript, version: "V3" },
  poolStakeCredentialHash,
  NETWORK_ID,
  true
).address;
const poolValidatorRewardAddress = serializeRewardAddress(
  poolStakeCredentialHash,
  true,
  NETWORK_ID
);
const poolAddressData = scriptAddress(baseHash, poolStakeCredentialHash, true);
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
const orderValidatorScript = applyParamsToScript(
  orderValidator[0].compiledCode,
  [
    conStr(1, [builtinByteString(poolBatchingValidatorHash)]),
    conStr(1, [builtinByteString(orderCanclValidatorHash)]),
  ],
  "JSON"
);
const orderValidatorScriptHash = resolveScriptHash(orderValidatorScript, "V3");
const orderValidatorAddress = serializePlutusScript(
  { code: baseScript, version: "V3" },
  orderValidatorScriptHash,
  NETWORK_ID,
  true
).address;
const orderValidatorRewardAddress = serializeRewardAddress(
  orderValidatorScriptHash,
  true,
  NETWORK_ID
);

// User CIP 113 Address
const userCip113Addr = serializePlutusScript(
  { code: baseScript, version: "V3" },
  wallet1VK,
  NETWORK_ID,
  false
).address;
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

const sTokenPolicyId =
  "ec107b98e0026f9c8a4a010eaa9d1ca81aa53c0d862e5cb488f1cf85";
const sTokenB = stringToHex("sToken");
const sTokenUnit = sTokenPolicyId + sTokenB;
const sTokenAssetB = mConStr0([sTokenPolicyId, sTokenB]);

// compute lp asset name
const sha3 = (hex: string): string => {
  const hash = new SHA3(256);
  hash.update(hex, "hex");
  return hash.digest("hex");
};
const AdaAssetASha256 = sha3("" + AdaTokenA);
const sTokenAssetBSha256 = sha3(sTokenUnit);
const sTokenAdaLpAssetName = sha3(AdaAssetASha256 + sTokenAssetBSha256);

console.log("sTokenAdaLpAssetName:", sTokenAdaLpAssetName);
// asset supplies
const AdaTokenSupply = 1500000000;
const myTokenOneSupply = 1500;
// const AdaTokenSupply = 15000000;
// const myTokenOneSupply = 15;
const sTokenSupply = myTokenOneSupply;
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

console.log("userCip113Addr:", userCip113Addr);

// sToken cip113 utxo from the live smart-wallet state
const sTokenCip113Utxos = (
  await blockchainProvider.fetchAddressUTxOs(userCip113Addr)
).filter((utxo) => utxo.output.amount.some((a) => a.unit === sTokenUnit));
const sTokenCip113Utxo = [...sTokenCip113Utxos].sort((a, b) => {
  const aQty = BigInt(
    a.output.amount.find((amount) => amount.unit === sTokenUnit)?.quantity ??
      "0"
  );
  const bQty = BigInt(
    b.output.amount.find((amount) => amount.unit === sTokenUnit)?.quantity ??
      "0"
  );
  return aQty === bQty ? 0 : aQty > bQty ? -1 : 1;
})[0];
if (!sTokenCip113Utxo) {
  throw new Error("sTokenCip113Utxo not found");
}
const sTokenCip113Balance = Number(sTokenCip113Utxo.output.amount[1].quantity);
console.log("sTokenCip113Utxos:", sTokenCip113Utxos.length);
console.log("sTokenCip113Balance:", sTokenCip113Balance);

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
  "addr_test1qrc2acqmw4d6u72thft9a8eddlwzscrs3ewnquxnzdfefl2rvrppl4x24vc63cyx3ca5r0kyfpde5dvc8xrcq8l3q7zqkxvd3c";
const { pubKeyHash: lorenzoVK } = deserializeAddress(lorenzoAddress);
const lorenzoSmartAddr = serializePlutusScript(
  { code: baseScript, version: "V3" },
  lorenzoVK,
  NETWORK_ID
).address;

console.log(baseHash, lorenzoVK);

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
const poolBatchingScriptTxHash =
  "969c0ee422489749e0cb3d080877c7046866ed5718400e6b9d816bb6db38c2cb";
const poolBatchingScriptTxIndex = 0;
// pool ref script
const poolScriptTxHash =
  "1748d195b78c3be99d6c058175b485e4587fad32f5ec0a545c67da9ff6fa228d";
const poolScriptTxIndex = 0;
// order ref script
const orderScriptTxHash =
  "64b79b6b3964a6bd9cb54c038137741b42e45a4ea721f1ae739d5cac172efb3b";
const orderScriptTxIndex = 0;

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
// // pool batching ref script
// const poolBatchingScriptTxHash =
//   "c3e7559ed8c00d25ccaff20b485dd4573843070ae96b25d2ce2b0b65c8c03d8c";
// const poolBatchingScriptTxIndex = 0;
// // pool ref script
// const poolScriptTxHash =
//   "47e405c8fe12fa891b01497658796be1317dea037647f4361daca39a7f33db82";
// const poolScriptTxIndex = 0;
// // order ref script
// const orderScriptTxHash =
//   "271af0b304ec2cac2e02f96d0557a71f529a087e8aeb2a22b35ec53256dd366a";
// const orderScriptTxIndex = 0;

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
  programmableBaseValidator,
  baseScript,
  baseHash,
  // baseRewardAddress,
  sTokenB,
  sTokenAssetB,
  sTokenAdaLpAssetName,
  sTokenUnit,
  sTokenSupply,
  sTokenCip113Utxo,
  sTokenCip113Balance,
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
