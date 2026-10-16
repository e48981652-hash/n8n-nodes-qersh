import type { ICredentialType, INodeProperties, Icon } from 'n8n-workflow';

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
				'The connection key the Qersh app shows once for the wallet (it starts with qsk_). It only verifies the signature of each delivery; Qersh has no server to call.',
		},
	];
}
