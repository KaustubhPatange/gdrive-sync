import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import cliProgress from 'cli-progress';
import { Command } from 'commander';
import type { GaxiosError, GaxiosResponse } from 'gaxios';
import type { drive_v3 } from 'googleapis';
import { authenticate } from './internal/auth';
import {
	checkFileExists,
	checkFolderExists,
	createFolder,
	downloadFile,
	extractFileIdFromUrl,
	getDriveFolderId,
	isFolder,
	verifyFolderExists,
} from './internal/drive';
import {
	calculateDirectoryHashes,
	findChangedFiles,
	hashMapToString,
	parseHashFile,
} from './internal/hash';
import log from './internal/log';

const HASH_FILENAME = '.gdown-hashes.txt';

/**
 * Upload a file to Google Drive with progress bar
 */
async function uploadFile(
	drive: drive_v3.Drive,
	filePath: string,
	folderId: string,
	forceOverwrite = false,
): Promise<{ id?: string; name?: string; upload: boolean }> {
	const fileName = path.basename(filePath);
	log.process(`Uploading ${fileName} to Google Drive...`);

	if (!fs.existsSync(filePath)) {
		log.error(`File not found: ${filePath}`);
		return { upload: false };
	}

	if (fs.statSync(filePath).isDirectory()) {
		log.error(
			`${filePath} is a directory. Use the upload-folder command instead.`,
		);
		return { upload: false };
	}

	let mimeType = 'application/octet-stream';
	if (filePath.endsWith('.json')) mimeType = 'application/json';
	else if (filePath.endsWith('.txt')) mimeType = 'text/plain';
	else if (filePath.endsWith('.png')) mimeType = 'image/png';
	else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg'))
		mimeType = 'image/jpeg';
	else if (filePath.endsWith('.pdf')) mimeType = 'application/pdf';
	else if (filePath.endsWith('.zip')) mimeType = 'application/zip';
	else if (filePath.endsWith('.tar.gz') || filePath.endsWith('.tgz'))
		mimeType = 'application/gzip';

	const existingFileId = await checkFileExists(drive, fileName, folderId);

	if (existingFileId && !forceOverwrite) {
		log.warning(
			`File "${fileName}" already exists in the target folder. Use --force to overwrite.`,
		);
		return { id: existingFileId, name: fileName, upload: false };
	}

	const fileSize = fs.statSync(filePath).size;
	const fileSizeKB = Math.round(fileSize / 1024);

	const progressBar = new cliProgress.SingleBar({
		format: 'Uploading |{bar}| {percentage}% | {value}/{total} KB',
		barCompleteChar: '\u2588',
		barIncompleteChar: '\u2591',
	});

	progressBar.start(fileSizeKB, 0);

	const fileStream = fs.createReadStream(filePath);
	let uploadedBytes = 0;

	fileStream.on('data', (chunk) => {
		uploadedBytes += chunk.length;
		progressBar.update(Math.round(uploadedBytes / 1024));
	});

	const media = {
		mimeType,
		body: fileStream,
	};

	try {
		let response: GaxiosResponse<drive_v3.Schema$File>;

		if (existingFileId && forceOverwrite) {
			response = await drive.files.update({
				fileId: existingFileId,
				media,
				fields: 'id,name',
			});
			progressBar.stop();
			log.success(
				`File updated successfully: ${fileName} (ID: ${response.data.id})`,
			);
		} else {
			const fileMetadata = {
				name: fileName,
				parents: [folderId],
			};

			response = await drive.files.create({
				requestBody: fileMetadata,
				media,
				fields: 'id,name',
			});
			progressBar.stop();
			log.success(
				`File uploaded successfully: ${fileName} (ID: ${response.data.id})`,
			);
		}

		assert(response.data.id);
		assert(response.data.name);

		return { id: response.data.id, name: response.data.name, upload: true };
	} catch (error) {
		progressBar.stop();
		log.error(`Error uploading file: ${(error as Error).message}`);
		throw error;
	}
}

/**
 * Upload a folder to Google Drive
 */
async function uploadFolder(
	drive: drive_v3.Drive,
	folderPath: string,
	targetFolderId: string,
	trackChanges = false,
	forceOverwrite = false,
) {
	if (!fs.existsSync(folderPath)) {
		log.error(`Folder not found: ${folderPath}`);
		return null;
	}

	if (!fs.statSync(folderPath).isDirectory()) {
		log.error(`${folderPath} is not a directory.`);
		return null;
	}

	const folderName = path.basename(folderPath);
	log.process(`Uploading folder ${folderName} to Google Drive...`);

	const folderMap = new Map<string, string>();
	folderMap.set(folderPath, targetFolderId);

	let filesToUpload: string[] = [];
	let totalFiles = 0;
	let uploadedFiles = 0;

	if (trackChanges) {
		log.process('Calculating file hashes...');
		const localHashes = await calculateDirectoryHashes(folderPath);

		const remoteHashes = await getHashFileFromDrive(drive, targetFolderId);
		const remoteHashFileId = remoteHashes.fileId;

		if (remoteHashes.exists) {
			log.info('Comparing local files with remote hashes...');
			const { changed, added, unchanged } = findChangedFiles(
				localHashes,
				remoteHashes.hashes,
			);

			log.info(
				`Found ${changed.length} changed files, ${added.length} new files, ${unchanged.length} unchanged files.`,
			);

			filesToUpload = [...changed, ...added];
			totalFiles = filesToUpload.length;

			if (totalFiles === 0) {
				log.success('No files need to be uploaded. All files are up to date.');
				return {
					folderName,
					targetFolderId,
					totalFiles: 0,
					uploadedFiles: 0,
				};
			}
		} else {
			log.info(
				'No hash file found on Google Drive. Will upload all files and create a new hash file.',
			);
			const getAllFiles = (dir: string, fileList: string[] = []): string[] => {
				const files = fs.readdirSync(dir);

				for (const file of files) {
					const filePath = path.join(dir, file);
					if (fs.statSync(filePath).isDirectory()) {
						getAllFiles(filePath, fileList);
					} else {
						fileList.push(filePath);
					}
				}

				return fileList;
			};
			filesToUpload = getAllFiles(folderPath);
			totalFiles = filesToUpload.length;
		}

		log.info(`Found ${totalFiles} files to upload.`);

		const finalUploadedHashes = remoteHashes.exists
			? remoteHashes.hashes
			: localHashes;

		for (const filePath of filesToUpload) {
			const dirPath = path.dirname(path.relative(folderPath, filePath));

			let currentFolderId = targetFolderId;
			if (dirPath && dirPath !== '.') {
				const pathParts = dirPath.split(path.sep);

				let newFolderPath = folderPath;
				for (const part of pathParts) {
					newFolderPath = path.join(newFolderPath, part);

					if (!folderMap.has(newFolderPath)) {
						const folderExists = await checkFolderExists(
							drive,
							part,
							currentFolderId,
						);

						if (folderExists) {
							folderMap.set(newFolderPath, folderExists);
							currentFolderId = folderExists;
						} else {
							const newFolder = await createFolder(
								drive,
								part,
								currentFolderId,
							);
							folderMap.set(newFolderPath, newFolder.id);
							currentFolderId = newFolder.id;
						}
					} else {
						// biome-ignore lint/style/noNonNullAssertion: <explanation>
						currentFolderId = folderMap.get(newFolderPath)!;
					}
				}
			}

			try {
				const result = await uploadFile(
					drive,
					filePath,
					currentFolderId,
					forceOverwrite,
				);
				if (result.upload) {
					// biome-ignore lint/style/noNonNullAssertion: <explanation>
					finalUploadedHashes.set(filePath, localHashes.get(filePath)!);
					uploadedFiles++;
				}
			} catch (error) {
				log.error(`Failed to upload ${filePath}: ${(error as Error).message}`);
			}
		}

		await uploadHashFile(
			drive,
			targetFolderId,
			hashMapToString(finalUploadedHashes),
			remoteHashFileId,
		);
	} else {
		const countFiles = (dir: string) => {
			const items = fs.readdirSync(dir);
			for (const item of items) {
				const itemPath = path.join(dir, item);
				const stats = fs.statSync(itemPath);
				if (stats.isFile()) {
					totalFiles++;
				} else if (stats.isDirectory()) {
					countFiles(itemPath);
				}
			}
		};

		countFiles(folderPath);

		log.info(`Found ${totalFiles} files to upload.`);

		const processFolder = async (
			localFolderPath: string,
			parentFolderId: string,
		) => {
			const items = fs.readdirSync(localFolderPath);

			for (const item of items) {
				const itemPath = path.join(localFolderPath, item);
				const stats = fs.statSync(itemPath);

				if (stats.isFile()) {
					try {
						const result = await uploadFile(
							drive,
							itemPath,
							parentFolderId,
							forceOverwrite,
						);
						if (result.upload) {
							uploadedFiles++;
						}
					} catch (error) {
						log.error(
							`Failed to upload ${itemPath}: ${(error as Error).message}`,
						);
					}
				} else if (stats.isDirectory()) {
					const subfolderResponse = await createFolder(
						drive,
						item,
						parentFolderId,
					);
					const subFolderId = subfolderResponse.id;

					folderMap.set(itemPath, subFolderId);

					await processFolder(itemPath, subFolderId);
				}
			}
		};

		await processFolder(folderPath, targetFolderId);
	}

	log.success(
		`Folder upload complete. Uploaded ${uploadedFiles}/${totalFiles} files.`,
	);
	return {
		folderName,
		targetFolderId,
		totalFiles,
		uploadedFiles,
	};
}

/**
 * Get hash file from Google Drive
 */
async function getHashFileFromDrive(
	drive: drive_v3.Drive,
	folderId: string,
): Promise<{ exists: boolean; hashes: Map<string, string>; fileId?: string }> {
	log.process('Retrieving hash file from Google Drive...');

	try {
		const res = await drive.files.list({
			q: `'${folderId}' in parents and name='${HASH_FILENAME}' and trashed=false`,
			fields: 'files(id, name)',
		});

		if (res.data.files && res.data.files.length === 0) {
			log.info('No hash file found on Google Drive.');
			return { exists: false, hashes: new Map() };
		}

		// biome-ignore lint/style/noNonNullAssertion: <explanation>
		const fileId = res.data.files!.at(0)!.id!;

		// Download the hash file
		const response = await drive.files.get({
			fileId: fileId,
			alt: 'media',
		});

		const content = response.data as string;
		const hashes = parseHashFile(content);

		log.success(`Hash file found with ${hashes.size} entries.`);
		return { exists: true, hashes, fileId };
	} catch (error) {
		log.warning(`Error retrieving hash file: ${(error as Error).message}`);
		return { exists: false, hashes: new Map() };
	}
}

/**
 * Upload hash file to Google Drive
 */
async function uploadHashFile(
	drive: drive_v3.Drive,
	folderId: string,
	hashContent: string,
	existingFileId?: string,
): Promise<void> {
	log.process('Uploading hash file to Google Drive...');

	const tempFilePath = path.join(process.cwd(), HASH_FILENAME);
	fs.writeFileSync(tempFilePath, hashContent);

	try {
		if (existingFileId) {
			await drive.files.update({
				fileId: existingFileId,
				media: {
					mimeType: 'text/plain',
					body: fs.createReadStream(tempFilePath),
				},
			});
			log.success('Hash file updated successfully.');
		} else {
			const fileMetadata = {
				name: HASH_FILENAME,
				parents: [folderId],
				mimeType: 'text/plain',
			};

			await drive.files.create({
				requestBody: fileMetadata,
				media: {
					mimeType: 'text/plain',
					body: fs.createReadStream(tempFilePath),
				},
				fields: 'id',
			});
			log.success('Hash file created successfully.');
		}
	} catch (error) {
		log.error(`Error uploading hash file: ${(error as Error).message}`);
	} finally {
		if (fs.existsSync(tempFilePath)) {
			fs.unlinkSync(tempFilePath);
		}
	}
}

/**
 * List all files in a folder recursively
 */
async function listFolderContents(
	drive: drive_v3.Drive,
	folderId: string,
	relativePath = '',
): Promise<Array<{ id: string; name: string; path: string }>> {
	const res = await drive.files.list({
		q: `'${folderId}' in parents and trashed=false`,
		fields: 'files(id, name, mimeType)',
		pageSize: 1000,
	});

	const files = res.data.files ?? [];
	let allFiles: Array<{ id: string; name: string; path: string }> = [];

	for (const file of files) {
		assert(file.id);
		assert(file.name);

		const filePath = path.join(relativePath, file.name);

		if (file.mimeType === 'application/vnd.google-apps.folder') {
			log.info(`Found folder: ${filePath}`);

			const subFiles = await listFolderContents(drive, file.id, filePath);
			allFiles = allFiles.concat(subFiles);
		} else {
			allFiles.push({
				id: file.id,
				name: file.name,
				path: filePath,
			});
		}
	}

	return allFiles;
}

/**
 * Download a folder from Google Drive
 */
async function downloadFolder(
	drive: drive_v3.Drive,
	folderId: string,
	outputPath: string,
) {
	log.process('Downloading folder from Google Drive...');

	const folderMetadata = await drive.files.get({
		fileId: folderId,
		fields: 'name',
	});

	// biome-ignore lint/style/noNonNullAssertion: <explanation>
	const folderName = folderMetadata.data.name!;
	const folderPath = path.join(outputPath, folderName);

	log.info(`Creating folder structure for ${folderName}...`);

	if (!fs.existsSync(folderPath)) {
		fs.mkdirSync(folderPath, { recursive: true });
	}

	const files = await listFolderContents(drive, folderId);

	log.info(`Found ${files.length} files to download.`);

	const downloadPromises = files.map(async (file) => {
		const filePath = path.join(folderPath, file.path);
		const dirPath = path.dirname(filePath);

		if (!fs.existsSync(dirPath)) {
			fs.mkdirSync(dirPath, { recursive: true });
		}

		try {
			const fileMetadata = await drive.files.get({
				fileId: file.id,
				fields: 'mimeType',
			});

			// biome-ignore lint/style/noNonNullAssertion: <explanation>
			const isGoogleDoc = fileMetadata.data.mimeType!.includes(
				'application/vnd.google-apps',
			);

			if (isGoogleDoc) {
				await downloadFile(drive, file.id, dirPath);
			} else {
				await downloadFile(drive, file.id, filePath);
			}

			return { success: true, file };
		} catch (error) {
			return { success: false, file, error };
		}
	});

	const results = await Promise.all(downloadPromises);

	const successful = results.filter((r) => r.success).length;
	const failed = results.filter((r) => !r.success).length;

	log.success(`Downloaded ${successful} files successfully.`);
	if (failed > 0) {
		log.warning(`Failed to download ${failed} files.`);
		results
			.filter((r) => !r.success)
			.forEach((result) => {
				log.error(
					`Failed to download ${result.file.name}: ${(result.error as Error).message}`,
				);
			});
	}

	return {
		folderPath,
		totalFiles: files.length,
		successful,
		failed,
	};
}

/**
 * List files in a Google Drive folder
 */
async function listFiles(drive: drive_v3.Drive, folderId: string) {
	log.process('Listing files in Google Drive folder...');

	const res = await drive.files.list({
		q: `'${folderId}' in parents and trashed=false`,
		fields: 'files(id, name, mimeType, createdTime, size)',
		orderBy: 'name',
	});

	// biome-ignore lint/style/noNonNullAssertion: <explanation>
	const files = res.data.files!;

	if (files.length === 0) {
		log.info('No files found in the folder.');
		return [];
	}

	log.success(`Found ${files.length} files:`);
	files.forEach((file) => {
		const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
		const icon = isFolder ? '📁' : '📄';
		const size = file.size
			? `(${Math.round(Number(file.size) / 1024)} KB)`
			: '';
		console.log(`${icon} ${file.name} - ID: ${file.id} ${size}`);
	});

	return files;
}

/**
 * Format error details for better display
 */
function formatErrorDetails(error: GaxiosError): string {
	if (!error) return 'Unknown error occurred';

	if (error.response?.data) {
		const { data } = error.response;
		if (data.error) {
			if (data.error.message) {
				return `API Error: ${data.error.message}`;
			}
			if (typeof data.error === 'string') {
				return `API Error: ${data.error}`;
			}
		}
		return `API Error: ${JSON.stringify(data)}`;
	}

	// Handle network errors
	if (error.code === 'ENOTFOUND') {
		return 'Network Error: Could not reach the server. Please check your internet connection.';
	}

	if (error.code === 'ECONNREFUSED') {
		return 'Network Error: Connection refused. The server may be down or unreachable.';
	}

	// Handle authentication errors
	if (error.message?.includes('invalid_grant')) {
		return 'Authentication Error: Invalid credentials or expired token. Please check your authentication settings.';
	}

	// Handle file system errors
	if (error.code === 'ENOENT') {
		return 'File System Error: File or directory not found';
	}

	if (error.code === 'EACCES') {
		return 'File System Error: Permission denied';
	}

	// Default to the error message or toString if nothing else works
	return error.message || error.toString();
}

async function main() {
	try {
		const program = new Command();

		program
			.name('gdown')
			.description('Google Drive file upload and download utility')
			.version('1.0.0');

		const addAuthOption = (command: Command) => {
			return command.option('-c, --config <path>', 'Path to JSON5 config file');
		};

		// Unified upload command for both files and folders
		addAuthOption(
			program
				.command('upload')
				.description('Upload a file or folder to Google Drive')
				.argument('<path>', 'Path to the file or folder to upload')
				.option(
					'-f, --folder <target>',
					'Target folder ID or URL in Google Drive',
				)
				.option(
					'-t, --track',
					'Track file changes and only upload modified files',
					false,
				)
				.option(
					'--force',
					'Overwrite existing files with the same name',
					false,
				),
		).action(async (sourcePath, options) => {
			if (!options.config) {
				log.error('Config file path is required. Use --config option.');
				return;
			}

			if (!options.folder) {
				log.error('Target folder ID or URL is required. Use --folder option.');
				return;
			}

			if (!fs.existsSync(sourcePath)) {
				log.error(`Path not found: ${sourcePath}`);
				return;
			}

			const drive = await authenticate(options.config);
			log.success('Successfully authenticated to Google Drive.');

			const isDirectory = fs.statSync(sourcePath).isDirectory();

			try {
				let targetFolderId: string = options.folder;

				if (
					options.folder.includes('drive.google.com') ||
					options.folder.includes('docs.google.com')
				) {
					const extractedId = extractFileIdFromUrl(options.folder);
					if (extractedId) {
						targetFolderId = extractedId;
						log.info(`Extracted folder ID from URL: ${targetFolderId}`);
					} else {
						log.error('Could not extract folder ID from the provided URL.');
						return;
					}
				}

				const folderInfo = await verifyFolderExists(drive, targetFolderId);
				log.info(`Target folder: ${folderInfo.name}`);

				if (isDirectory) {
					log.info(`Uploading folder: ${sourcePath}`);
					if (options.track) {
						log.info('Change tracking enabled. Only uploading modified files.');
					}
					if (options.force) {
						log.info('Force mode enabled. Existing files will be overwritten.');
					}
					await uploadFolder(
						drive,
						sourcePath,
						targetFolderId,
						options.track,
						options.force,
					);
				} else {
					if (options.track) {
						log.warning(
							'Change tracking is only available for folder uploads. Ignoring --track option.',
						);
					}
					log.info(`Uploading file: ${sourcePath}`);
					if (options.force) {
						log.info('Force mode enabled. Existing files will be overwritten.');
					}
					await uploadFile(drive, sourcePath, targetFolderId, options.force);
				}
			} catch (error) {
				log.error(`Upload failed: ${(error as Error).message}`);
			}
		});

		// Download command
		addAuthOption(
			program
				.command('download')
				.description('Download a file or folder from Google Drive')
				.argument(
					'<fileIdOrUrl>',
					'ID or URL of the file or folder to download',
				)
				.option('-o, --output <path>', 'Output directory', '.'),
		).action(async (fileIdOrUrl, options) => {
			if (!options.config) {
				log.error('Config file path is required. Use --config option.');
				return;
			}

			let fileId = fileIdOrUrl;
			if (
				fileIdOrUrl.includes('drive.google.com') ||
				fileIdOrUrl.includes('docs.google.com')
			) {
				const extractedId = extractFileIdFromUrl(fileIdOrUrl);
				if (extractedId) {
					fileId = extractedId;
					log.info(`Extracted file ID from URL: ${fileId}`);
				} else {
					log.error('Could not extract file ID from the provided URL.');
					return;
				}
			}

			const drive = await authenticate(options.config);
			log.success('Successfully authenticated to Google Drive.');

			try {
				// Check if it's a folder
				const isDirectory = await isFolder(drive, fileId);

				if (isDirectory) {
					log.info(
						'The provided ID is a folder. Downloading folder contents...',
					);
					await downloadFolder(drive, fileId, options.output);
				} else {
					await downloadFile(drive, fileId, options.output);
				}
			} catch (err) {
				const error = err as GaxiosError;
				log.error(`Error: ${formatErrorDetails(error)}`);
				if (error.response && error.response.status === 404) {
					log.error(
						'The file or folder does not exist or you do not have permission to access it.',
					);
				}
			}
		});

		// List command
		addAuthOption(
			program
				.command('list')
				.description('List files in a Google Drive folder')
				.option(
					'-f, --folder <name>',
					'Folder name in Google Drive',
					'Uploads',
				),
		).action(async (options) => {
			if (!options.config) {
				log.error('Config file path is required. Use --config option.');
				return;
			}

			const drive = await authenticate(options.config);
			log.success('Successfully authenticated to Google Drive.');

			try {
				const folderId = await getDriveFolderId(drive, options.folder);
				await listFiles(drive, folderId);
			} catch (error) {
				log.error(`List failed: ${(error as Error).message}`);
			}
		});

		// Info command
		addAuthOption(
			program
				.command('info')
				.description('Get information about a Google Drive file or URL')
				.argument('<fileIdOrUrl>', 'ID or URL of the file'),
		).action(async (fileIdOrUrl, options) => {
			if (!options.config) {
				log.error('Config file path is required. Use --config option.');
				return;
			}

			let fileId = fileIdOrUrl;
			if (
				fileIdOrUrl.includes('drive.google.com') ||
				fileIdOrUrl.includes('docs.google.com')
			) {
				const extractedId = extractFileIdFromUrl(fileIdOrUrl);
				if (extractedId) {
					fileId = extractedId;
					log.info(`Extracted file ID from URL: ${fileId}`);
				} else {
					log.error('Could not extract file ID from the provided URL.');
					return;
				}
			}

			const drive = await authenticate(options.config);
			log.success('Successfully authenticated to Google Drive.');

			try {
				const response = await drive.files.get({
					fileId: fileId,
					fields:
						'id,name,mimeType,size,createdTime,modifiedTime,webViewLink,owners',
				});

				const file = response.data;
				log.highlight('File Information:');
				console.log(`Name: ${file.name}`);
				console.log(`ID: ${file.id}`);
				console.log(`Type: ${file.mimeType}`);
				if (file.size)
					console.log(
						`Size: ${Math.round(Number.parseInt(file.size) / 1024)} KB`,
					);
				console.log(`Created: ${file.createdTime}`);
				console.log(`Modified: ${file.modifiedTime}`);
				console.log(`Link: ${file.webViewLink}`);
				if (file.owners && file.owners.length > 0) {
					console.log(
						`Owner: ${file.owners[0].displayName} (${file.owners[0].emailAddress})`,
					);
				}
			} catch (err) {
				const error = err as GaxiosError;
				log.error(
					`Error retrieving file information: ${formatErrorDetails(error)}`,
				);
			}
		});

		program.parse();
	} catch (err) {
		const error = err as GaxiosError;
		log.error(`Error: ${formatErrorDetails(error)}`);
		process.exit(1);
	}
}

main();
