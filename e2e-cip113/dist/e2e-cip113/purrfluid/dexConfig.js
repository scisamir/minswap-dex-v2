import { mConStr0 } from "@meshsdk/core";
import { SHA3 } from "sha3";
import { TOKEN_ASSET_NAME, TOKEN_POLICY_ID } from "./config.js";
export const purrfluidUnit = TOKEN_POLICY_ID + TOKEN_ASSET_NAME;
export const purrfluidAssetB = mConStr0([TOKEN_POLICY_ID, TOKEN_ASSET_NAME]);
const sha3 = (hex) => {
    const hash = new SHA3(256);
    hash.update(hex, "hex");
    return hash.digest("hex");
};
const adaAssetHash = sha3("");
const purrfluidAssetHash = sha3(purrfluidUnit);
export const purrfluidAdaLpAssetName = sha3(adaAssetHash + purrfluidAssetHash);
