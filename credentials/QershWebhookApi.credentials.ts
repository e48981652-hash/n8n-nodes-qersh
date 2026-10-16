import type { ICredentialTestRequest, ICredentialType, IHttpRequestMethods, INodeProperties, Icon } from 'n8n-workflow';

/**
 * The credential test. Qersh has no server a key could be tried against (the key lives on the merchant's phone and
 * in this credential only), so the Test button checks the shape of the key with the rule the app applies when a key
 * is pasted into it: at least 24 characters, no white space, and a key that starts like a Qersh key is made of
 * [A-Za-z0-9_-] only. No request leaves n8n and the key is never part of the request: the request goes to a data:
 * URL, which n8n's HTTP layer answers locally. A well-formed key makes it a GET (answered 200); a malformed key makes
 * it a POST, which a data: URL refuses with 405, and the rule below turns that into the explanation.
 * Keep this rule identical to isAcceptableKey + isUsableSecret in nodes/Qersh/lib.
 */
const TEST_METHOD =
	'={{ (() => { const key = (($credentials.connectionSecret ?? "") + "").trim(); const ok = key.length >= 24 && !/\\s/.test(key) && (!key.startsWith("qsk_") || /^qsk_[A-Za-z0-9_-]+$/.test(key)); return ok ? "GET" : "POST"; })() }}';
const TEST_URL = 'data:text/plain,qersh-connection-key-shape-check';
const KEY_SHAPE_MESSAGE =
	'A connection key is at least 24 characters without spaces, and keys from the Qersh app start with qsk_. Copy it from the wallet page in the app.';

export class QershWebhookApi implements ICredentialType {
	name = 'qershWebhookApi';

	displayName = 'Qersh Webhook API';

	documentationUrl = 'https://qersh.cfd/en/integrations/n8n#credential';

	icon: Icon = { light: 'file:../icons/qersh.svg', dark: 'file:../icons/qersh.dark.svg' };

	properties: INodeProperties[] = [
		{
			displayName: 'Connection Key',
			name: 'connectionSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'The connection key the Qersh app shows once for the wallet (it starts with qsk_). It only verifies the signature of each delivery; Qersh has no server to call, so the Test button checks the shape of the key and nothing is sent anywhere.',
		},
	];

	/** n8n runs this before any node's `testedBy` function; see the comment on TEST_METHOD. */
	test: ICredentialTestRequest = {
		request: {
			method: TEST_METHOD as IHttpRequestMethods,
			url: TEST_URL,
		},
		rules: [{ type: 'responseCode', properties: { value: 405, message: KEY_SHAPE_MESSAGE } }],
	};
}
