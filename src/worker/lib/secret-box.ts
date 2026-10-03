/**
 * AES-GCM for secrets stored in D1 (the custom AI API key). The key is SETTINGS_ENCRYPTION_KEY: 32 random
 * bytes, base64 (`openssl rand -base64 32`). Stored form: "v1.<iv b64>.<ciphertext b64>".
 */

const b64 = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes as ArrayBuffer).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

async function importKey(secret: string | undefined) {
	const raw = secret ? unb64(secret) : null;
	if (raw?.length !== 32) throw new Error("SETTINGS_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
	return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export const canEncrypt = (secret: string | undefined) => (secret ? unb64(secret).length === 32 : false);

export async function encryptSecret(secret: string | undefined, plaintext: string) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const data = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		await importKey(secret),
		new TextEncoder().encode(plaintext),
	);
	return `v1.${b64(iv)}.${b64(data)}`;
}

export async function decryptSecret(secret: string | undefined, stored: string) {
	const [version, iv, data] = stored.split(".");
	if (version !== "v1" || !iv || !data) throw new Error("Unrecognised encrypted value");
	const plain = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: unb64(iv) },
		await importKey(secret),
		unb64(data),
	);
	return new TextDecoder().decode(plain);
}
