import type {
	ICredentialTestFunctions,
	ICredentialsDecrypted,
	INodeCredentialTestResult,
} from 'n8n-workflow';

import { isAcceptableKey } from './lib/core/config';

/**
 * Qersh has no server a credential could be tested against: the key lives on the merchant's phone and here. This
 * test therefore checks the shape of the key only, with the same rule the app applies when a key is pasted into it.
 * Both nodes declare it through `testedBy`, because n8n's lint requires every node that uses a credential to do so.
 */
export async function qershWebhookApiTest(
	this: ICredentialTestFunctions,
	credential: ICredentialsDecrypted,
): Promise<INodeCredentialTestResult> {
	const key = credential.data?.connectionSecret;
	if (isAcceptableKey(key)) {
		return {
			status: 'OK',
			message:
				'The key has the shape of a Qersh connection key. Qersh has no server to call, so only the format is checked; the first delivery proves the key.',
		};
	}
	return {
		status: 'Error',
		message:
			'A connection key is at least 24 characters without spaces, and keys from the Qersh app start with qsk_. Copy it from the wallet page in the app.',
	};
}
