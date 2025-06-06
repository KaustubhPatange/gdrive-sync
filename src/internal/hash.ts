import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Calculate SHA-256 hash of a file
 */
export async function calculateFileHash(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha256');
		const stream = fs.createReadStream(filePath);

		stream.on('data', (data) => {
			hash.update(data);
		});

		stream.on('end', () => {
			resolve(hash.digest('hex'));
		});

		stream.on('error', (error) => {
			reject(error);
		});
	});
}

/**
 * Calculate hashes for all files in a directory recursively
 */
export async function calculateDirectoryHashes(
	directory: string,
): Promise<Map<string, string>> {
	const hashes = new Map<string, string>();
	const baseDir = path.resolve(directory);

	async function processDirectory(dir: string) {
		const files = fs.readdirSync(dir).sort(); // Sort for consistent order

		for (const file of files) {
			const fullPath = path.join(dir, file);
			const stat = fs.statSync(fullPath);

			if (stat.isDirectory()) {
				await processDirectory(fullPath);
			} else {
				const relativePath = path
					.relative(baseDir, fullPath)
					.replace(/\\/g, '/');
				const hash = await calculateFileHash(fullPath);
				hashes.set(relativePath, hash);
			}
		}
	}

	await processDirectory(baseDir);
	return hashes;
}

/**
 * Parse hash file content into a map
 */
export function parseHashFile(content: string): Map<string, string> {
	const hashes = new Map<string, string>();

	const lines = content.split('\n').filter((line) => line.trim() !== '');

	for (const line of lines) {
		const [hash, filePath] = line.split('  ');
		if (hash && filePath) {
			hashes.set(filePath, hash);
		}
	}

	return hashes;
}

/**
 * Convert hash map to file content
 */
export function hashMapToString(hashes: Map<string, string>): string {
	let content = '';

	for (const [filePath, hash] of hashes.entries()) {
		content += `${hash}  ${filePath}\n`;
	}

	return content;
}

/**
 * Find changed files by comparing local hashes with remote hashes
 */
export function findChangedFiles(
	localHashes: Map<string, string>,
	remoteHashes: Map<string, string>,
): { changed: string[]; added: string[]; unchanged: string[] } {
	const changed: string[] = [];
	const added: string[] = [];
	const unchanged: string[] = [];

	// Check for changed and added files
	for (const [filePath, localHash] of localHashes.entries()) {
		const remoteHash = remoteHashes.get(filePath);

		if (!remoteHash) {
			added.push(filePath);
		} else if (localHash !== remoteHash) {
			changed.push(filePath);
		} else {
			unchanged.push(filePath);
		}
	}

	return { changed, added, unchanged };
}
