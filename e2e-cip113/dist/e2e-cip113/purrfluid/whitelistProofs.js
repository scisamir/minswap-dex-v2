import { deserializeDatum } from "@meshsdk/core";
import { blockchainProvider } from "../setup.js";
import { whitelistPolicyId, whitelistSpendAddr } from "./config.js";
export const fetchWhitelistProofs = async (keyHashes) => {
    const whitelistUtxos = await blockchainProvider.fetchAddressUTxOs(whitelistSpendAddr);
    return keyHashes.map((keyHash) => {
        const utxo = whitelistUtxos.find((candidate) => {
            if (!candidate.output.plutusData)
                return false;
            try {
                const hasMembershipToken = candidate.output.amount.some((asset) => asset.unit === whitelistPolicyId + keyHash &&
                    asset.quantity === "1");
                if (!hasMembershipToken)
                    return false;
                const datum = deserializeDatum(candidate.output.plutusData);
                return (datum?.fields?.[0]?.bytes ?? "") === keyHash;
            }
            catch {
                return false;
            }
        });
        if (!utxo) {
            throw new Error(`PurrFluid whitelist membership not found for credential: ${keyHash}. ` +
                "Insert this credential with purrfluid/insertWhitelist.ts before building the DEX transaction.");
        }
        return { keyHash, utxo };
    });
};
export const uniqueWhitelistUtxos = (proofs) => {
    const seen = new Set();
    return proofs
        .map((proof) => proof.utxo)
        .filter((utxo) => {
        const key = `${utxo.input.txHash}#${utxo.input.outputIndex}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
};
