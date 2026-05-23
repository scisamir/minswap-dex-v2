/**
 * registerStake.ts — Step 1b
 *
 * Registers the stake credentials for:
 *   1. programmable_logic_global — needed for transfers
 *   2. purrfluid_transfer (transferLogic) — needed for transfers
 *   3. purrfluid_issuer (adminContract) — needed for token registration
 *
 * Must be run once after deployWhitelist.ts and before registerToken.ts.
 *
 * Cost: 2 ADA deposit per credential (refundable on deregistration)
 */
import { BlockfrostProvider, MeshTxBuilder } from "@meshsdk/core";
import { blockchainProvider, wallet1 } from "../setup.js";
import { globalRewardAddr, transferLogicRewardAddr, adminContractRewardAddr, NETWORK_ID, validateConfig, } from "./config.js";
validateConfig();
const blockfrostId = process.env.BLOCKFROST_ID;
const txProvider = blockfrostId
    ? new BlockfrostProvider(blockfrostId)
    : blockchainProvider;
console.log("=== Step 1b: Register Stake Credentials ===");
console.log("globalRewardAddr:       ", globalRewardAddr);
console.log("transferLogicRewardAddr:", transferLogicRewardAddr);
console.log("adminContractRewardAddr:", adminContractRewardAddr);
const rewardAccounts = [
    { label: "programmable_logic_global", address: globalRewardAddr },
    { label: "purrfluid_transfer", address: transferLogicRewardAddr },
    { label: "purrfluid_issuer", address: adminContractRewardAddr },
];
const isRegistered = async (address) => {
    try {
        const account = await txProvider.fetchAccountInfo(address);
        return account.active;
    }
    catch (error) {
        const status = error?.status ??
            error?.response?.status ??
            error?.data?.status_code;
        const errorText = (() => {
            if (typeof error === "string")
                return error;
            try {
                return JSON.stringify(error);
            }
            catch {
                return String(error);
            }
        })();
        if (Number(status) === 404 ||
            errorText.includes('"status":404') ||
            errorText.includes('"status_code":404')) {
            return false;
        }
        throw error;
    }
};
const missingAccounts = [];
for (const account of rewardAccounts) {
    const registered = await isRegistered(account.address);
    console.log(`${account.label}: ${registered ? "already registered" : "needs registration"}`);
    if (!registered)
        missingAccounts.push(account);
}
if (!missingAccounts.length) {
    console.log("\nAll stake credentials are already registered.");
    process.exit(0);
}
const walletUtxos = await wallet1.getUtxos();
const walletAddress = await wallet1.getChangeAddress();
const txBuilder = new MeshTxBuilder({
    fetcher: txProvider,
    evaluator: txProvider,
    submitter: txProvider,
});
for (const account of missingAccounts) {
    txBuilder.registerStakeCertificate(account.address);
}
const unsignedTx = await txBuilder
    .selectUtxosFrom(walletUtxos)
    .changeAddress(walletAddress)
    .setNetwork(NETWORK_ID === 0 ? "preview" : "mainnet")
    .complete();
if (process.env.PURRFLUID_DRY_RUN === "1") {
    console.log("\nDry run complete — stake registration transaction built.");
    process.exit(0);
}
const signedTx = await wallet1.signTx(unsignedTx);
const txHash = await txProvider.submitTx(signedTx);
console.log("\n================================");
console.log("Stake credentials registered!");
console.log("================================");
console.log("TX Hash:", txHash);
console.log("Registered:", missingAccounts.map((account) => account.label).join(", "));
