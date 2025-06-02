import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import {
	calculateFileHash,
	calculateDirectoryHashes,
	parseHashFile,
	hashMapToString,
	findChangedFiles,
} from '../../src/internal/hash';

const rootDir = process.cwd();

describe('hash module', () => {
	let sandbox: sinon.SinonSandbox;

	beforeEach(() => {
		sandbox = sinon.createSandbox();
	});

	afterEach(() => {
		sandbox.restore();
	});

	describe('calculateFileHash', () => {
		it('should calculate SHA-256 hash of a file', async () => {
			const hash = await calculateFileHash(
				path.join(rootDir, 'assets/example-dir/hash.test.txt'),
			);

			const expectedHash =
				'72cf1997e6bbeaa8b5413dba3d8c9138eaa2dae3433a6c548b1c31207a157935';
			assert.strictEqual(hash, expectedHash);
		});

		it('should reject with error if stream emits error', async () => {
			// Calculate hash and expect it to reject
			try {
				await calculateFileHash('test.txt');
				assert.fail('Should have thrown an error');
			} catch (error) {
				assert.strictEqual((error as any).code, 'ENOENT');
			}
		});
	});

	describe('calculateDirectoryHashes', () => {
		it('should calculate hashes for all files in a directory recursively', async () => {
			const exampleDir = path.join(rootDir, 'assets/example-dir');
			const hashes = await calculateDirectoryHashes(exampleDir);

			// Verify
			assert.strictEqual(hashes.size, 2);
			assert.strictEqual(
				hashes.get('hash.test.txt'),
				'72cf1997e6bbeaa8b5413dba3d8c9138eaa2dae3433a6c548b1c31207a157935',
			);
			assert.strictEqual(
				hashes.get('folderA/sample.txt'),
				'260e8ca3dee21cd2b5a7e24cff039269558776b3e080f6f4caf7bcebc68a2cc5',
			);
		});
	});

	describe('parseHashFile', () => {
		it('should parse hash file content into a map', () => {
			const content = 'hash1  file1.txt\nhash2  path/to/file2.txt\n';
			const hashes = parseHashFile(content);

			assert.strictEqual(hashes.size, 2);
			assert.strictEqual(hashes.get('file1.txt'), 'hash1');
			assert.strictEqual(hashes.get('path/to/file2.txt'), 'hash2');
		});

		it('should handle empty lines', () => {
			const content = 'hash1  file1.txt\n\nhash2  path/to/file2.txt\n\n';
			const hashes = parseHashFile(content);

			assert.strictEqual(hashes.size, 2);
			assert.strictEqual(hashes.get('file1.txt'), 'hash1');
			assert.strictEqual(hashes.get('path/to/file2.txt'), 'hash2');
		});

		it('should return empty map for empty content', () => {
			const content = '';
			const hashes = parseHashFile(content);

			assert.strictEqual(hashes.size, 0);
		});
	});

	describe('hashMapToString', () => {
		it('should convert hash map to file content', () => {
			const hashes = new Map<string, string>();
			hashes.set('file1.txt', 'hash1');
			hashes.set('path/to/file2.txt', 'hash2');

			const content = hashMapToString(hashes);

			// Split by lines and sort for consistent comparison
			const lines = content.trim().split('\n').sort();
			assert.strictEqual(lines.length, 2);
			assert.strictEqual(lines[0], 'hash1  file1.txt');
			assert.strictEqual(lines[1], 'hash2  path/to/file2.txt');
		});

		it('should return empty string for empty map', () => {
			const hashes = new Map<string, string>();
			const content = hashMapToString(hashes);
			assert.strictEqual(content, '');
		});
	});

	describe('findChangedFiles', () => {
		it('should find changed, added, and unchanged files', () => {
			const localHashes = new Map<string, string>();
			localHashes.set('unchanged.txt', 'hash1');
			localHashes.set('changed.txt', 'hash2-new');
			localHashes.set('added.txt', 'hash3');

			const remoteHashes = new Map<string, string>();
			remoteHashes.set('unchanged.txt', 'hash1');
			remoteHashes.set('changed.txt', 'hash2-old');
			remoteHashes.set('deleted.txt', 'hash4');

			const result = findChangedFiles(localHashes, remoteHashes);

			assert.deepStrictEqual(result.unchanged, ['unchanged.txt']);
			assert.deepStrictEqual(result.changed, ['changed.txt']);
			assert.deepStrictEqual(result.added, ['added.txt']);
		});

		it('should handle empty maps', () => {
			const localHashes = new Map<string, string>();
			const remoteHashes = new Map<string, string>();

			const result = findChangedFiles(localHashes, remoteHashes);

			assert.deepStrictEqual(result.unchanged, []);
			assert.deepStrictEqual(result.changed, []);
			assert.deepStrictEqual(result.added, []);
		});

		it('should handle all new files', () => {
			const localHashes = new Map<string, string>();
			localHashes.set('file1.txt', 'hash1');
			localHashes.set('file2.txt', 'hash2');

			const remoteHashes = new Map<string, string>();

			const result = findChangedFiles(localHashes, remoteHashes);

			assert.deepStrictEqual(result.unchanged, []);
			assert.deepStrictEqual(result.changed, []);
			assert.deepStrictEqual(result.added, ['file1.txt', 'file2.txt']);
		});

		it('should handle all unchanged files', () => {
			const localHashes = new Map<string, string>();
			localHashes.set('file1.txt', 'hash1');
			localHashes.set('file2.txt', 'hash2');

			const remoteHashes = new Map<string, string>();
			remoteHashes.set('file1.txt', 'hash1');
			remoteHashes.set('file2.txt', 'hash2');

			const result = findChangedFiles(localHashes, remoteHashes);

			assert.deepStrictEqual(result.unchanged, ['file1.txt', 'file2.txt']);
			assert.deepStrictEqual(result.changed, []);
			assert.deepStrictEqual(result.added, []);
		});
	});
});
