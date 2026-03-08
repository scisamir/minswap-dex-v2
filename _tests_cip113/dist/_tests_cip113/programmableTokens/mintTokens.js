/**
 * mintTokens.ts — Step 2
 *
 * Mints sTokens via issuance_mint and sends them to wallet1's smart wallet address.
 *
 * The issuance_mint validator checks that the minting_logic_cred (adminContractHash)
 * is invoked. We satisfy this by doing a withdraw-zero of the admin contract.
 *
 * Prerequisites: BLACKLIST_MINT_HASH filled in config.ts (Step 1 done)
 * After running: copy TOKEN_POLICY_ID printed below into config.ts
 */
import { MeshTxBuilder, byteString, conStr0, conStr1, integer, } from "@meshsdk/core";
import { blockchainProvider, wallet1, wallet1VK, wallet1Collateral, } from "../setup.js";
import { BLACKLIST_MINT_HASH, TOKEN_ASSET_NAME, TOKEN_SUPPLY, wallet1SmartAddr, issuanceCbor, issuancePolicyId, adminContractCbor, adminContractHash, adminContractRewardAddr, NETWORK_ID, validateConfig, } from "./config.js";
validateConfig();
if (!BLACKLIST_MINT_HASH) {
    throw new Error("BLACKLIST_MINT_HASH is empty — run Step 1 (deployBlacklist.ts) first");
}
// issuance_mint redeemer: Mint(Script(adminContractHash))
const mintRedeemer = conStr0([conStr1([byteString(adminContractHash)])]);
console.log("=== Step 2: Mint sTokens ===");
console.log("issuancePolicyId:       ", issuancePolicyId);
console.log("tokenAssetName:         ", TOKEN_ASSET_NAME, "(sToken)");
console.log("supply:                 ", TOKEN_SUPPLY);
console.log("destination:            ", wallet1SmartAddr);
console.log("adminContractHash:      ", adminContractHash);
console.log("adminContractRewardAddr:", adminContractRewardAddr);
const walletUtxos = await wallet1.getUtxos();
const walletAddress = await wallet1.getChangeAddress();
const txBuilder = new MeshTxBuilder({
    fetcher: blockchainProvider,
    evaluator: blockchainProvider,
    submitter: blockchainProvider,
    verbose: true,
});
const unsignedTx = await txBuilder
    // Tokens to wallet1's smart address with inline datum
    .txOut(wallet1SmartAddr, [
    { unit: "lovelace", quantity: "2000000" },
    {
        unit: issuancePolicyId + TOKEN_ASSET_NAME,
        quantity: String(TOKEN_SUPPLY),
    },
])
    .txOutInlineDatumValue(conStr0([]), "JSON")
    // issuer_admin_contract withdraw-zero (authorizes the mint)
    .withdrawalPlutusScriptV3()
    .withdrawal(adminContractRewardAddr, "0")
    .withdrawalScript(adminContractCbor)
    .withdrawalRedeemerValue(integer(0), "JSON")
    // issuance_mint — redeemer: Mint(Script(adminContractHash))
    .mintPlutusScriptV3()
    .mint(String(TOKEN_SUPPLY), issuancePolicyId, TOKEN_ASSET_NAME)
    .mintingScript(issuanceCbor)
    .mintRedeemerValue(mintRedeemer, "JSON")
    .txInCollateral(wallet1Collateral.input.txHash, wallet1Collateral.input.outputIndex)
    .selectUtxosFrom(walletUtxos)
    .changeAddress(walletAddress)
    .requiredSignerHash(wallet1VK)
    .setNetwork(NETWORK_ID === 0 ? "preview" : "mainnet")
    .complete();
const signedTx = await wallet1.signTx(unsignedTx, true);
const txHash = await wallet1.submitTx(signedTx);
console.log("\n================================");
console.log("Tokens minted!");
console.log("================================");
console.log("TX Hash:        ", txHash);
console.log("TOKEN_POLICY_ID:", issuancePolicyId);
console.log("Amount:         ", TOKEN_SUPPLY, "sToken");
console.log("Smart wallet:   ", wallet1SmartAddr);
console.log("\nCopy into config.ts:");
console.log(`   TOKEN_POLICY_ID = "${issuancePolicyId}"`);
