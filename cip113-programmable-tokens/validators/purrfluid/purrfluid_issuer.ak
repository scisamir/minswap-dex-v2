use aiken/collection/list
use cardano/address.{Credential, Script, VerificationKey}
use cardano/transaction.{Transaction}

validator purrfluid_issuer(admin_cred: Credential) {
  withdraw(_redeemer: Data, _account: Credential, self: Transaction) {
    admin_authorized(admin_cred, self)
  }

  else(_) {
    fail
  }
}

fn admin_authorized(admin_cred: Credential, self: Transaction) {
  when admin_cred is {
    VerificationKey(admin_pkh) ->
      list.any(self.extra_signatories, fn(sig) { sig == admin_pkh })
    Script(admin_hash) ->
      list.any(
        self.inputs,
        fn(inp) { inp.output.address.payment_credential == Script(admin_hash) },
      )
  }
}
