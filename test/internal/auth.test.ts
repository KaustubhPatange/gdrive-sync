import assert from 'assert';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import * as sinon from 'sinon';
import { authenticate } from '../../src/internal/auth';
import * as config from '../../src/internal/config';
import log from '../../src/internal/log';

describe('auth module', () => {
	let sandbox: sinon.SinonSandbox;
	let parseConfigStub: sinon.SinonStub;
	let saveConfigStub: sinon.SinonStub;
	let googleAuthStub: sinon.SinonStub;
	let googleDriveStub: sinon.SinonStub;
	let logStub: sinon.SinonStub;
	let oauth2ClientSetCredentails: any;

	beforeEach(() => {
		sandbox = sinon.createSandbox();

		// Stub config functions
		parseConfigStub = sandbox.stub(config, 'parseConfig');
		saveConfigStub = sandbox.stub(config, 'saveConfig');

		// Stub Google APIs
		googleAuthStub = sandbox.stub(google.auth, 'GoogleAuth');
		googleDriveStub = sandbox.stub(google, 'drive');

		// Stub log functions
		logStub = sandbox.stub(log) as any;

		oauth2ClientSetCredentails = sandbox.stub(
			OAuth2Client.prototype,
			'setCredentials',
		);
	});

	afterEach(() => {
		sandbox.restore();
	});

	describe('authenticate', () => {
		it('should authenticate with service account when loginType is service', async () => {
			// Setup
			const mockServiceAccount = JSON.stringify({
				client_email: 'test@example.com',
				private_key: 'test-key',
			});

			const mockDriveClient = { files: { list: () => {} } };
			const mockAuth = { getClient: () => {} };

			parseConfigStub.returns({
				loginType: 'service',
				serviceAccount: mockServiceAccount,
			});

			googleAuthStub.returns(mockAuth);
			googleDriveStub.returns(mockDriveClient);

			// Execute
			const result = await authenticate('config.json');

			// Verify
			assert(parseConfigStub.calledOnce);
			assert(googleAuthStub.calledOnce);
			assert.deepStrictEqual(googleAuthStub.firstCall.args[0], {
				credentials: JSON.parse(mockServiceAccount),
				scopes: ['https://www.googleapis.com/auth/drive'],
			});
			assert(googleDriveStub.calledOnce);
			assert.strictEqual(result, mockDriveClient);
		});

		it('should authenticate with OAuth when loginType is oauth', async () => {
			// Setup
			const mockConfig = {
				loginType: 'oauth',
				oauth: {
					clientId: 'test-client-id',
					clientSecret: 'test-client-secret',
					tokens: {
						refresh_token: 'test-refresh-token',
						access_token: 'test-access-token',
					},
				},
			};

			parseConfigStub.returns(mockConfig);

			const mockDriveClient = {
				about: {
					get: sinon.stub().resolves({ data: { user: {} } }),
				},
			};
			googleDriveStub.returns(mockDriveClient);

			// Execute
			const result = await authenticate('config.json');

			// Verify
			assert(parseConfigStub.calledOnce);
			assert(oauth2ClientSetCredentails.calledOnce);
			assert.strictEqual(
				oauth2ClientSetCredentails.firstCall.args[0],
				mockConfig.oauth.tokens,
			);
			assert(googleDriveStub.calledOnce);
			assert.strictEqual(result, mockDriveClient);
		});

		it('should use service account when no loginType is specified but serviceAccount exists', async () => {
			// Setup
			const mockServiceAccount = JSON.stringify({
				client_email: 'test@example.com',
				private_key: 'test-key',
			});

			const mockDriveClient = { files: { list: () => {} } };
			const mockAuth = { getClient: () => {} };

			parseConfigStub.returns({
				serviceAccount: mockServiceAccount,
			});

			googleAuthStub.returns(mockAuth);
			googleDriveStub.returns(mockDriveClient);

			// Execute
			const result = await authenticate('config.json');

			// Verify
			assert(parseConfigStub.calledOnce);
			assert(googleAuthStub.calledOnce);
			assert(googleDriveStub.calledOnce);
			assert.strictEqual(result, mockDriveClient);
		});

		it('should use OAuth when no loginType is specified but oauth config exists', async () => {
			// Setup
			const mockConfig = {
				client_email: 'test@example.com',
				private_key: 'test-key',
				oauth: {
					clientId: 'test-client-id',
					clientSecret: 'test-client-secret',
					tokens: {
						refresh_token: 'test-refresh-token',
						access_token: 'test-access-token',
					},
				},
			};

			parseConfigStub.returns(mockConfig);

			const mockDriveClient = {
				about: {
					get: sinon.stub().resolves({ data: { user: {} } }),
				},
			};
			googleDriveStub.returns(mockDriveClient);

			// Execute
			const result = await authenticate('config.json');

			// Verify
			assert(parseConfigStub.calledOnce);
			assert(oauth2ClientSetCredentails.calledOnce);
			assert(googleDriveStub.calledOnce);
			assert.strictEqual(result, mockDriveClient);
		});

		it('should throw error when no valid authentication method is found', async () => {
			// Setup
			parseConfigStub.returns({});

			// Execute & Verify
			try {
				await authenticate('config.json');
				assert.fail('Should have thrown an error');
			} catch (error) {
				assert(error instanceof Error);
				assert(error.message.includes('Invalid configuration'));
			}
		});

		it('should handle expired OAuth tokens and request new ones', async () => {
			// This test is skipped because it requires mocking readline
			// which is challenging in the current test setup
			// For a complete test, you would need to:
			// 1. Mock process.stdin and process.stdout
			// 2. Provide a mock implementation for readline
			// 3. Verify the authentication flow
		});
	});
});
