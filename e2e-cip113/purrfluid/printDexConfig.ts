import {
  authenPolicyId,
  factoryAddress,
  orderValidatorAddress,
  orderValidatorScriptHash,
  poolBatchingValidatorHash,
  poolValidatorAddress,
  poolValidatorScriptHash,
  userCip113Addr,
} from "../setup.js";
import {
  TOKEN_POLICY_ID,
  baseHash,
  validateConfig,
  whitelistPolicyId,
} from "./config.js";
import {
  purrfluidAdaLpAssetName,
  purrfluidUnit,
} from "./dexConfig.js";

validateConfig();

console.log("\n=== PurrFluid / Minswap DEX Configuration ===");
console.log("purrfluid policy:           ", TOKEN_POLICY_ID);
console.log("purrfluid unit:             ", purrfluidUnit);
console.log("purrfluid base hash:        ", baseHash);
console.log("whitelist policy:           ", whitelistPolicyId);
console.log("authen policy:              ", authenPolicyId);
console.log("pool credential to add:     ", poolValidatorScriptHash);
console.log("order credential to add:    ", orderValidatorScriptHash);
console.log("pool batching credential:   ", poolBatchingValidatorHash);
console.log("wallet smart address:       ", userCip113Addr);
console.log("factory address:            ", factoryAddress);
console.log("pool address:               ", poolValidatorAddress);
console.log("order address:              ", orderValidatorAddress);
console.log("ADA/PurrFluid LP asset name:", purrfluidAdaLpAssetName);
