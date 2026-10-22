// Prints a new app key pair (Ed25519), in the format @shopnex/marketplace-sdk/keys uses:
//   private key  snxk_ + base64url(PKCS#8)  → the app's SHOPNEX_APP_KEY (or STRIPE_APP_KEY for the bundled app)
//   public key   base64url(raw)             → what Shopnex / the marketplace store
const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
const b64url = (buffer) => Buffer.from(buffer).toString('base64url')
console.log(`private key: snxk_${b64url(await crypto.subtle.exportKey('pkcs8', pair.privateKey))}`)
console.log(`public key:  ${b64url(await crypto.subtle.exportKey('raw', pair.publicKey))}`)
