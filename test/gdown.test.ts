import assert from 'assert';
import * as path from 'path';
import * as sinon from 'sinon';
import { uploadFile } from '../src/gdown';
import log from '../src/internal/log';
import * as cliProgress from 'cli-progress';

const rootDir = process.cwd();
interface DriveMockApi {
	files: {
		create: sinon.SinonStub;
		update: sinon.SinonStub;
		list: sinon.SinonStub;
	};
}

describe('gdown', () => {
	describe('uploadFile', () => {
		let driveStub: DriveMockApi;
		let logStub: sinon.SinonStubbedInstance<typeof log>;

		const testFilePath = path.join(rootDir, 'assets/example-dir/hash.test.txt');
		const testFolderId = 'test-folder-id';
		const testFileId = 'test-file-id';
		const testFileName = 'hash.test.txt';

		beforeEach(() => {
			driveStub = {
				files: {
					create: sinon.stub().resolves({
						data: { id: testFileId, name: testFileName },
					}),
					update: sinon.stub().resolves({
						data: { id: testFileId, name: testFileName },
					}),
					list: sinon.stub().resolves({
						data: { files: [] },
					}),
				},
			};

			sinon.stub(cliProgress.SingleBar.prototype, 'start');
			sinon.stub(cliProgress.SingleBar.prototype, 'stop');

			logStub = sinon.stub(log) as any;
		});

		afterEach(() => {
			sinon.restore();
		});

		it('should upload a file successfully', async () => {
			const result = await uploadFile(
				driveStub as any,
				testFilePath,
				testFolderId,
			);

			assert.deepStrictEqual(result, {
				id: testFileId,
				name: testFileName,
				upload: true,
			});

			assert.strictEqual(driveStub.files.create.calledOnce, true);

			const createCall = driveStub.files.create.getCall(0).args[0];
			assert.deepStrictEqual(createCall.requestBody, {
				name: testFileName,
				parents: [testFolderId],
			});
			assert.strictEqual(createCall.fields, 'id,name');
		});

		it('should return upload: false when file does not exist', async () => {
			const result = await uploadFile(
				driveStub as any,
				'some-randome-path.txt',
				testFolderId,
			);

			assert.deepStrictEqual(result, { upload: false });
			assert.strictEqual(driveStub.files.create.called, false);
		});

		it('should return upload: false when path is a directory', async () => {
			const result = await uploadFile(
				driveStub as any,
				path.dirname(testFilePath),
				testFolderId,
			);

			assert.deepStrictEqual(result, { upload: false });
			assert.strictEqual(driveStub.files.create.called, false);
		});

		it('should not overwrite existing file without force flag', async () => {
			// Simulate an existing file
			driveStub.files.list = sinon.stub().resolves({
				data: { files: [{ id: testFileId, name: testFileName }] },
			});

			const result = await uploadFile(
				driveStub as any,
				testFilePath,
				testFolderId,
				false,
			);

			assert.deepStrictEqual(result, {
				id: testFileId,
				name: testFileName,
				upload: false,
			});

			assert.strictEqual(driveStub.files.create.called, false);
			assert.strictEqual(driveStub.files.update.called, false);
		});

		it('should overwrite existing file with force flag', async () => {
			// Simulate an existing file
			driveStub.files.list = sinon.stub().resolves({
				data: { files: [{ id: testFileId, name: testFileName }] },
			});

			const result = await uploadFile(
				driveStub as any,
				testFilePath,
				testFolderId,
				true,
			);

			assert.deepStrictEqual(result, {
				id: testFileId,
				name: testFileName,
				upload: true,
			});

			assert.strictEqual(driveStub.files.update.calledOnce, true);
			assert.strictEqual(driveStub.files.create.called, false);

			const updateCall = driveStub.files.update.getCall(0).args[0];
			assert.strictEqual(updateCall.fileId, testFileId);
			assert.strictEqual(updateCall.fields, 'id,name');
		});

		it('should handle upload errors', async () => {
			const errorMessage = 'Upload failed';
			driveStub.files.create = sinon.stub().rejects(new Error(errorMessage));

			try {
				await uploadFile(driveStub as any, testFilePath, testFolderId);
				assert.fail('Should have thrown an error');
			} catch (error) {
				assert.strictEqual((error as Error).message, errorMessage);
			}
		});
	});
});
