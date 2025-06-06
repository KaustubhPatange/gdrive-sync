import assert from 'assert';
import * as path from 'path';
import * as cliProgress from 'cli-progress';
import * as sinon from 'sinon';
import { uploadFile } from '../src/gdown';
import * as gdown from '../src/gdown';
import * as drive from '../src/internal/drive';
import log from '../src/internal/log';

const rootDir = process.cwd();
interface DriveMockApi {
	files: {
		create: sinon.SinonStub;
		update: sinon.SinonStub;
		list: sinon.SinonStub;
	};
}

describe('gdown', () => {
	const testFilePath = path.join(rootDir, 'assets/example-dir/hash.test.txt');
	const testFolderPath = path.join(rootDir, 'assets/example-dir');
	const testFolderId = 'test-folder-id';
	const testFileId = 'test-file-id';
	const testFileName = 'hash.test.txt';
	let driveStub: DriveMockApi;
	let logStub: sinon.SinonStubbedInstance<typeof log>;
	let parentSandbox: sinon.SinonSandbox;
	beforeEach(() => {
		parentSandbox = sinon.createSandbox();
		driveStub = {
			files: {
				create: parentSandbox.stub().resolves({
					data: { id: testFileId, name: testFileName },
				}),
				update: parentSandbox.stub().resolves({
					data: { id: testFileId, name: testFileName },
				}),
				list: parentSandbox.stub().resolves({
					data: { files: [] },
				}),
			},
		};

		parentSandbox.stub(cliProgress.SingleBar.prototype, 'start');
		parentSandbox.stub(cliProgress.SingleBar.prototype, 'stop');

		logStub = parentSandbox.stub(log) as any;
	});

	afterEach(() => {
		parentSandbox.restore();
	});

	describe('uploadFolder', () => {
		let sandbox: sinon.SinonSandbox;
		beforeEach(() => {
			sandbox = sinon.createSandbox();
		});

		afterEach(() => {
			sandbox.restore();
		});

		it('should upload folder successfully with tracking and without file hashes', async () => {
			const uploadFileStub = sandbox
				.stub(gdown, 'uploadFile')
				.resolves({ upload: true });
			const getHashfileFromDriveStub = sandbox
				.stub(drive, 'getHashFileFromDrive')
				.resolves({ exists: false, hashes: new Map() });
			const newFolderSpy = sandbox.spy(drive, 'createFolder');
			const uploadHashfileToDriveStub = sandbox.stub(drive, 'uploadHashFile');

			await gdown.uploadFolder(
				driveStub as any,
				testFolderPath,
				testFolderId,
				true,
			);

			assert(getHashfileFromDriveStub.calledOnce);
			assert(getHashfileFromDriveStub.getCall(0).args[1] === testFolderId);

			assert(newFolderSpy.callCount === 2);
			assert(uploadFileStub.callCount === 3);

			assert(uploadHashfileToDriveStub.calledOnce);
			assert(
				uploadHashfileToDriveStub.getCall(0).args[2].trim().split('\n')
					.length === 3,
			);
		});

		it('should upload folder successfully with tracking and folder exists with file hashes', async () => {
			const uploadFileStub = sandbox
				.stub(gdown, 'uploadFile')
				.resolves({ upload: true });
			sandbox.stub(drive, 'checkFolderExists').callsFake((_, part) => {
				if (part === 'folderA') return Promise.resolve('folderA-id');
				return Promise.resolve(null);
			});
			const newFolderSpy = sandbox.spy(drive, 'createFolder');

			sandbox.stub(drive, 'getHashFileFromDrive').resolves({
				exists: true,
				hashes: new Map([
					[
						'hash.test.txt',
						'72cf1997e6bbeaa8b5413dba3d8c9138eaa2dae3433a6c548b1c31207a157935',
					],
					[
						'folderA/sample.txt',
						'260e8ca3dee21cd2b5a7e24cff039269558776b3e080f6f4caf7bcebc68a2cc5',
					],
				]),
				fileId: 'test-hash-id',
			});
			const uploadHashfileToDriveStub = sandbox.stub(drive, 'uploadHashFile');

			await gdown.uploadFolder(
				driveStub as any,
				testFolderPath,
				testFolderId,
				true,
			);

			assert(newFolderSpy.callCount == 1);
			assert(newFolderSpy.getCall(0).args[1] === 'folderB');
			assert(newFolderSpy.getCall(0).args[2] === 'folderA-id');

			assert(uploadFileStub.callCount === 1);
			assert(uploadFileStub.getCall(0).args[1].includes('folderB/sampleB.txt'));

			assert(uploadHashfileToDriveStub.calledOnce);

			const hashContentLines = uploadHashfileToDriveStub
				.getCall(0)
				.args[2].trim()
				.split('\n');

			const lastLine = hashContentLines[2].split(/\s+/);

			assert(hashContentLines.length === 3);
			assert(
				lastLine[0] ===
					'078495d36bf1f56383622a84c29cba1d9917227a2f4151af99553db95ee7b342',
			);
			assert(lastLine[1] === 'folderA/folderB/sampleB.txt');
		});

		it('should upload folder successfully without tracking', async () => {
			const uploadFileStub = sandbox
				.stub(gdown, 'uploadFile')
				.resolves({ upload: true });
			sandbox.stub(drive, 'checkFolderExists').callsFake((_, part) => {
				if (part === 'folderA') return Promise.resolve('folderA-id');
				return Promise.resolve(null);
			});
			const newFolderSpy = sandbox.spy(drive, 'createFolder');

			await gdown.uploadFolder(
				driveStub as any,
				testFolderPath,
				testFolderId,
				false,
			);

			assert(newFolderSpy.callCount === 2);
			assert(
				newFolderSpy
					.getCalls()
					.map((it) => it.args[1])
					.sort()
					.join(',') === 'folderA,folderB',
			);
			assert(uploadFileStub.callCount === 3);
			assert(
				uploadFileStub
					.getCalls()
					.map((it) => it.args[1])
					.sort()
					.join(',') ===
					`${path.join(testFolderPath, 'folderA/folderB/sampleB.txt')},${path.join(testFolderPath, 'folderA/sample.txt')},${path.join(testFolderPath, 'hash.test.txt')}`,
			);
		});
	});

	describe('uploadFile', () => {
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
