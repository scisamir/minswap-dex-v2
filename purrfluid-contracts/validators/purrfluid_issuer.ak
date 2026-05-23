use cardano/address.{Credential}
use cardano/transaction.{Transaction}
use utils.{tx_signed}

validator purrfluid_issuer(admin_cred: Credential) {
  withdraw(_redeemer: Data, _account: Credential, self: Transaction) {
    tx_signed(admin_cred, self)
  }

  else(_) {
    fail
  }
}
