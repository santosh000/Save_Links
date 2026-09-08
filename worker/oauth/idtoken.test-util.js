// Test-only helper: RS256-signs Google-shaped OpenID Connect id_tokens with a
// freshly generated RSA key, so worker/oauth/google.test.js and worker/auth.test.js
// exercise the REAL Web Crypto signature-verification path — no network, fully
// deterministic. Also exposes the matching public JWK so tests can serve it back
// on the mocked Google /oauth2/v3/certs endpoint.
import { bytesToBase64Url } from './state.js'

/** Generate a fresh RSA key pair; publicJwk is ready for importKey('jwk'). */
export async function makeJwkKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  return { privateKey: keyPair.privateKey, publicJwk }
}

const textEncoder = new TextEncoder()

function encodeSegment(object) {
  return bytesToBase64Url(new Uint8Array(textEncoder.encode(JSON.stringify(object))))
}

/**
 * Sign a compact JWT with the given claims, header, kid and private key.
 * @returns {Promise<string>} the `header.payload.signature` JWT string
 */
export async function signTestIdToken({ claims, privateKey, kid = 'test-kid', header = {} }) {
  const head = { alg: 'RS256', typ: 'JWT', kid, ...header }
  const unsigned = `${encodeSegment(head)}.${encodeSegment(claims)}`
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, textEncoder.encode(unsigned)))
  return `${unsigned}.${bytesToBase64Url(signature)}`
}