// A side-effect module, so that ES import ordering does the sequencing for us.
//
// Calling installCrypto() as a statement in _layout.tsx would NOT be enough:
// import declarations are hoisted and evaluated before any statement in the
// file, so the polyfill would land after every imported module body had already
// run. Imported as the first import, this one's body runs before the later
// imports are evaluated -- which is the guarantee we actually need, because the
// thing being protected is module-scope ULID minting.
import { installCrypto, assertCryptoInstalled } from "./crypto";

installCrypto();
assertCryptoInstalled();
