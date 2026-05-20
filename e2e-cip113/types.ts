import { BuiltinByteString, ConStr0, ConStr1, ConStr2, ConStr3, Integer, PubKeyAddress, ScriptAddress } from "@meshsdk/core";

type CredentialType = ConStr1<[BuiltinByteString]>;

type AssetType = ConStr0<[BuiltinByteString, BuiltinByteString]>;

type OptionalIntType = ConStr0<[Integer]> | ConStr1<[]>;

type BoolType = ConStr0<[]> | ConStr1<[]>;

export type PoolDatumType = ConStr0<[
  CredentialType,
  AssetType,
  AssetType,
  Integer,
  Integer,
  Integer,
  Integer,
  Integer,
  OptionalIntType,
  BoolType,
]>;

type OrderAuthorizationMethodType = ConStr0<[BuiltinByteString]> | ConStr1<[BuiltinByteString]> | ConStr2<[BuiltinByteString]> | ConStr3<[BuiltinByteString]>;

type AddressType = PubKeyAddress | ScriptAddress;

export type OrderDatumType = ConStr0<[
  OrderAuthorizationMethodType,
  AddressType,
]>;
