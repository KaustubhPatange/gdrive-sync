import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import cliProgress from 'cli-progress';
import type { GaxiosError } from 'gaxios';
import type { drive_v3 } from 'googleapis';
import log from './log';

/**
 * Extract file ID from Google Drive URL
 */
export function extractFileIdFromUrl(url: string): string | null {
	// Handle URLs like https://drive.google.com/file/d/{fileId}/view?usp=drive_link
	const fileRegex = /\/file\/d\/([a-zA-Z0-9_-]+)/;
	const fileMatch = url.match(fileRegex);
	if (fileMatch?.[1]) {
		return fileMatch[1];
	}

	// Handle URLs like https://drive.google.com/open?id={fileId}
	const openRegex = /[?&]id=([a-zA-Z0-9_-]+)/;
	const openMatch = url.match(openRegex);
	if (openMatch?.[1]) {
		return openMatch[1];
	}

	// Handle URLs like https://docs.google.com/document/d/{fileId}/edit
	const docsRegex = /\/d\/([a-zA-Z0-9_-]+)/;
	const docsMatch = url.match(docsRegex);
	if (docsMatch?.[1]) {
		return docsMatch[1];
	}

	// Handle URLs like https://drive.google.com/drive/folders/{folderId}?resourcekey=...
	const folderRegex = /\/folders\/([a-zA-Z0-9_-]+)/;
	const folderMatch = url.match(folderRegex);
	if (folderMatch?.[1]) {
		return folderMatch[1];
	}

	return null;
}

/**
 * Download or export a file from Google Drive
 */
export async function downloadFile(
	drive: drive_v3.Drive,
	fileId: string,
	outputPath: string,
) {
	const fileMetadata = await drive.files.get({
		fileId: fileId,
		fields: 'name,size,mimeType',
	});

	const fileName = fileMetadata.data.name;
	const mimeType = fileMetadata.data.mimeType;
	const fileSize = Number.parseInt(fileMetadata.data.size || '0');

	const hasExtension = path.extname(outputPath) !== '';
	const isDirectory =
		!hasExtension &&
		((fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory()) ||
			!fs.existsSync(outputPath));

	let filePath: string;

	assert(mimeType, new Error('Fail to determine mimetype'));
	assert(fileName, new Error('Fail to determine fileName'));

	const isGoogleDoc = mimeType.includes('application/vnd.google-apps');

	if (isGoogleDoc) {
		log.process(`Exporting Google Workspace document: ${fileName}`);

		let exportMimeType = 'application/pdf';
		let exportExtension = '.pdf';

		if (mimeType === 'application/vnd.google-apps.document') {
			exportMimeType =
				'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
			exportExtension = '.docx';
		} else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
			exportMimeType =
				'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
			exportExtension = '.xlsx';
		} else if (mimeType === 'application/vnd.google-apps.presentation') {
			exportMimeType =
				'application/vnd.openxmlformats-officedocument.presentationml.presentation';
			exportExtension = '.pptx';
		} else if (mimeType === 'application/vnd.google-apps.drawing') {
			exportMimeType = 'image/png';
			exportExtension = '.png';
		}

		if (isDirectory) {
			const fileNameWithoutExt = path.parse(fileName).name;
			filePath = path.join(outputPath, fileNameWithoutExt + exportExtension);
		} else {
			filePath = outputPath;
		}

		const outputDir = path.dirname(filePath);
		if (!fs.existsSync(outputDir)) {
			fs.mkdirSync(outputDir, { recursive: true });
		}

		const dest = fs.createWriteStream(filePath);

		log.process(
			`Exporting ${fileName} as ${path.extname(filePath).substring(1).toUpperCase()}...`,
		);

		try {
			const response = await drive.files.export(
				{
					fileId: fileId,
					mimeType: exportMimeType,
				},
				{ responseType: 'stream' },
			);

			return new Promise((resolve, reject) => {
				let downloadedBytes = 0;

				response.data
					.on('data', (chunk: Buffer) => {
						downloadedBytes += chunk.length;
					})
					.on('end', () => {
						log.success(
							`File exported successfully: ${filePath} (${Math.round(downloadedBytes / 1024)} KB)`,
						);
						resolve(filePath);
					})
					.on('error', (err: Error) => {
						log.error(`Error exporting file: ${err.message}`);
						reject(err);
					})
					.pipe(dest);
			});
		} catch (err) {
			const error = err as GaxiosError;
			log.error(`Failed to export ${fileName}: ${error.message}`);

			if (error.response && error.response.status === 403) {
				log.warning('Export failed. Trying to download directly...');
				return downloadRegularFile(drive, fileId, filePath, fileName, fileSize);
			}

			throw error;
		}
	} else {
		if (isDirectory) {
			filePath = path.join(outputPath, fileName);
		} else {
			filePath = outputPath;
		}

		return downloadRegularFile(drive, fileId, filePath, fileName, fileSize);
	}
}

/**
 * Download a regular (non-Google Workspace) file
 */
async function downloadRegularFile(
	drive: drive_v3.Drive,
	fileId: string,
	filePath: string,
	fileName: string,
	fileSize: number,
) {
	log.process(`Downloading ${fileName} from Google Drive...`);

	const outputDir = path.dirname(filePath);
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	const dest = fs.createWriteStream(filePath);

	const response = await drive.files.get(
		{
			fileId: fileId,
			alt: 'media',
		},
		{ responseType: 'stream' },
	);

	const progressBar = new cliProgress.SingleBar({
		format: 'Downloading |{bar}| {percentage}% | {value}/{total} KB',
		barCompleteChar: '\u2588',
		barIncompleteChar: '\u2591',
		hideCursor: true,
	});

	const fileSizeKB = Math.round(fileSize / 1024) || 100; // Use 100KB as default if size is unknown
	progressBar.start(fileSizeKB, 0);

	let downloadedBytes = 0;

	return new Promise((resolve, reject) => {
		response.data
			.on('data', (chunk: Buffer) => {
				downloadedBytes += chunk.length;
				progressBar.update(Math.round(downloadedBytes / 1024));
			})
			.on('end', () => {
				progressBar.stop();
				log.success(`File downloaded successfully: ${filePath}`);
				resolve(filePath);
			})
			.on('error', (err: Error) => {
				progressBar.stop();
				log.error(`Error downloading file: ${err.message}`);
				reject(err);
			})
			.pipe(dest);
	});
}

/**
 * Get folder ID in Google Drive, throws error if not found
 */
export async function getDriveFolderId(
	drive: drive_v3.Drive,
	folderName: string,
) {
	const res = await drive.files.list({
		q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`,
		fields: 'files(id, name)',
	});

	if (res.data.files && res.data.files.length > 0) {
		log.success(`${folderName} folder found.`);
		// biome-ignore lint/style/noNonNullAssertion: <explanation>
		return res.data.files[0].id!;
	}

	throw new Error(
		`Folder "${folderName}" not found in Google Drive. Please create it first.`,
	);
}

/**
 * Verify folder exists in Google Drive
 */
export async function verifyFolderExists(
	drive: drive_v3.Drive,
	folderId: string,
) {
	try {
		const response = await drive.files.get({
			fileId: folderId,
			fields: 'name,mimeType',
		});

		if (response.data.mimeType !== 'application/vnd.google-apps.folder') {
			throw new Error('The provided ID is not a folder.');
		}

		return response.data;
	} catch (err) {
		const error = err as GaxiosError;
		if (error.response && error.response.status === 404) {
			throw new Error(
				`Folder with ID "${folderId}" not found in Google Drive.`,
			);
		}
		throw error;
	}
}

/**
 * Check if a folder exists in Google Drive
 */
export async function checkFolderExists(
	drive: drive_v3.Drive,
	folderName: string,
	parentFolderId: string,
): Promise<string | null | undefined> {
	const res = await drive.files.list({
		q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and '${parentFolderId}' in parents and trashed=false`,
		fields: 'files(id, name)',
	});

	if (res.data.files && res.data.files.length > 0) {
		return res.data.files[0].id;
	}

	return null;
}

/**
 * Check if a file is a folder
 */
export async function isFolder(
	drive: drive_v3.Drive,
	fileId: string,
): Promise<boolean> {
	const response = await drive.files.get({
		fileId: fileId,
		fields: 'mimeType',
	});

	return response.data.mimeType === 'application/vnd.google-apps.folder';
}

/**
 * Create a folder in Google Drive
 */
export async function createFolder(
	drive: drive_v3.Drive,
	folderName: string,
	parentId: string,
) {
	log.process(`Creating folder: ${folderName}`);

	const fileMetadata = {
		name: folderName,
		mimeType: 'application/vnd.google-apps.folder',
		parents: parentId ? [parentId] : undefined,
	};

	const response = await drive.files.create({
		requestBody: fileMetadata,
		fields: 'id,name',
	});

	log.success(`Folder created: ${folderName} (ID: ${response.data.id})`);
	assert(response.data.id);
	return { id: response.data.id };
}

/**
 * Check if a file with the same name exists in the folder
 */
export async function checkFileExists(
	drive: drive_v3.Drive,
	fileName: string,
	folderId: string,
): Promise<string | null | undefined> {
	const res = await drive.files.list({
		q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
		fields: 'files(id, name)',
	});

	if (res.data.files && res.data.files.length > 0) {
		return res.data.files[0].id;
	}

	return null;
}
