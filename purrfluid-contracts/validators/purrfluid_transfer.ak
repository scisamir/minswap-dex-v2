use cardano/address.{Credential}
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use types.{WhitelistProof}
use utils.{check_whitelist, collect_input_hashes, collect_output_hashes}

validator purrfluid_transfer(
  programmable_logic_base: Credential,
  token_policy: PolicyId,
  whitelist_policy: PolicyId,
) {
  withdraw(
    proofs: List<WhitelistProof>,
    _account: Credential,
    self: Transaction,
  ) {
    let input_hashes =
      collect_input_hashes(self.inputs, programmable_logic_base, token_policy)

    let output_hashes =
      collect_output_hashes(self.outputs, programmable_logic_base, token_policy)

    let remaining_proofs =
      check_whitelist(
        input_hashes,
        proofs,
        self.reference_inputs,
        whitelist_policy,
      )

    let remaining_proofs =
      check_whitelist(
        output_hashes,
        remaining_proofs,
        self.reference_inputs,
        whitelist_policy,
      )

    when remaining_proofs is {
      [] -> True
      _ -> fail
    }
  }

  else(_) {
    fail
  }
}
