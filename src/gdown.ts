import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import log from './internal/log'
import { authenticate } from './internal/auth'
import { extractFileIdFromUrl } from './internal/drive'
import cliProgress from 'cli-progress';

/**
 * Get or create a folder in Google Drive
 */
async function getDriveFolderId(drive: any, folderName: string) {
  const res = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`,
    fields: 'files(id, name)',
  });

  if (res.data.files.length > 0) {
    log.success(`${folderName} folder found.`);
    return res.data.files[0].id;
  }

  // Create folder if it doesn't exist
  log.info(`${folderName} folder not found. Creating...`);
  const fileMetadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };

  const folder = await drive.files.create({
    resource: fileMetadata,
    fields: 'id',
  });

  log.success(`${folderName} folder created.`);
  return folder.data.id;
}

/**
 * Upload a file to Google Drive
 */
async function uploadFile(drive: any, filePath: string, folderId: string) {
  const fileName = path.basename(filePath);
  log.process(`Uploading ${fileName} to Google Drive...`);
  
  if (!fs.existsSync(filePath)) {
    log.error(`File not found: ${filePath}`);
    return null;
  }

  if (fs.statSync(filePath).isDirectory()) {
    log.error(`${filePath} is a directory. This utility only supports uploading files.`);
    return null;
  }

  let mimeType = 'application/octet-stream';
  if (filePath.endsWith('.json')) mimeType = 'application/json';
  else if (filePath.endsWith('.txt')) mimeType = 'text/plain';
  else if (filePath.endsWith('.png')) mimeType = 'image/png';
  else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) mimeType = 'image/jpeg';
  else if (filePath.endsWith('.pdf')) mimeType = 'application/pdf';
  else if (filePath.endsWith('.zip')) mimeType = 'application/zip';
  else if (filePath.endsWith('.tar.gz') || filePath.endsWith('.tgz')) mimeType = 'application/gzip';

  const fileMetadata = {
    name: fileName,
    parents: [folderId],
  };

  const media = {
    mimeType,
    body: fs.createReadStream(filePath),
  };

  try {
    const response = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id,name',
    });

    log.success(`File uploaded successfully: ${fileName} (ID: ${response.data.id})`);
    return response.data;
  } catch (error) {
    log.error(`Error uploading file: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Download a file from Google Drive
 */
async function downloadFile(drive: any, fileId: string, outputPath: string) {
  
  const fileMetadata = await drive.files.get({
    fileId: fileId,
    fields: 'name,size'
  });
  
  const fileName = fileMetadata.data.name;
  const fileSize = parseInt(fileMetadata.data.size || '0');
  
  const hasExtension = path.extname(outputPath) !== '';
  const filePath = hasExtension ? outputPath : path.join(outputPath, fileName);
  
  log.process(`Downloading ${fileName} from Google Drive...`);

  const outputDir = path.dirname(filePath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const dest = fs.createWriteStream(filePath);
  
  const response = await drive.files.get({
    fileId: fileId,
    alt: 'media'
  }, { responseType: 'stream' });
  
  const progressBar = new cliProgress.SingleBar({
    format: 'Downloading |{bar}| {percentage}% | {value}/{total} KB',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });
  
  const fileSizeKB = Math.round(fileSize / 1024);
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
 * List files in a Google Drive folder
 */
async function listFiles(drive: any, folderId: string) {
  log.process('Listing files in Google Drive folder...');
  
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, mimeType, createdTime, size)',
    orderBy: 'name',
  });
  
  const files = res.data.files;
  
  if (files.length === 0) {
    log.info('No files found in the folder.');
    return [];
  }
  
  log.success(`Found ${files.length} files:`);
  files.forEach((file: any) => {
    const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
    const icon = isFolder ? '📁' : '📄';
    const size = file.size ? `(${Math.round(file.size / 1024)} KB)` : '';
    console.log(`${icon} ${file.name} - ID: ${file.id} ${size}`);
  });
  
  return files;
}

async function main() {
  try {
    const program = new Command();
    
    program
      .name('gdown')
      .description('Google Drive file upload and download utility')
      .version('1.0.0');
    
    const addAuthOption = (command: Command) => {
      return command
        .option('-c, --config <path>', 'Path to JSON5 config file');
    };
    
    addAuthOption(
      program
        .command('upload')
        .description('Upload a file to Google Drive')
        .argument('<file>', 'Path to the file to upload')
        .option('-f, --folder <name>', 'Target folder name in Google Drive', 'Uploads')
    ).action(async (file, options) => {
      if (!options.config) {
        log.error('Config file path is required. Use --config option.');
        return;
      }
      
      const drive = await authenticate(options.config);
      log.success('Successfully authenticated to Google Drive.');
      
      const folderId = await getDriveFolderId(drive, options.folder);
      await uploadFile(drive, file, folderId);
    });
    
    // Download command
    addAuthOption(
      program
        .command('download')
        .description('Download a file from Google Drive')
        .argument('<fileIdOrUrl>', 'ID or URL of the file to download')
        .option('-o, --output <path>', 'Output directory', '.')
    ).action(async (fileIdOrUrl, options) => {
      if (!options.config) {
        log.error('Config file path is required. Use --config option.');
        return;
      }
      
      let fileId = fileIdOrUrl;
      if (fileIdOrUrl.includes('drive.google.com') || fileIdOrUrl.includes('docs.google.com')) {
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
      
      await downloadFile(drive, fileId, options.output);
    });
    
    // List command
    addAuthOption(
      program
        .command('list')
        .description('List files in a Google Drive folder')
        .option('-f, --folder <name>', 'Folder name in Google Drive', 'Uploads')
    ).action(async (options) => {
      if (!options.config) {
        log.error('Config file path is required. Use --config option.');
        return;
      }
      
      const drive = await authenticate(options.config);
      log.success('Successfully authenticated to Google Drive.');
      
      const folderId = await getDriveFolderId(drive, options.folder);
      await listFiles(drive, folderId);
    });
    
    // Info command
    addAuthOption(
      program
        .command('info')
        .description('Get information about a Google Drive file or URL')
        .argument('<fileIdOrUrl>', 'ID or URL of the file')
    ).action(async (fileIdOrUrl, options) => {
      if (!options.config) {
        log.error('Config file path is required. Use --config option.');
        return;
      }
      
      let fileId = fileIdOrUrl;
      if (fileIdOrUrl.includes('drive.google.com') || fileIdOrUrl.includes('docs.google.com')) {
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
          fields: 'id,name,mimeType,size,createdTime,modifiedTime,webViewLink,owners'
        });
        
        const file = response.data;
        log.highlight('File Information:');
        console.log(`Name: ${file.name}`);
        console.log(`ID: ${file.id}`);
        console.log(`Type: ${file.mimeType}`);
        if (file.size) console.log(`Size: ${Math.round(parseInt(file.size) / 1024)} KB`);
        console.log(`Created: ${file.createdTime}`);
        console.log(`Modified: ${file.modifiedTime}`);
        console.log(`Link: ${file.webViewLink}`);
        if (file.owners && file.owners.length > 0) {
          console.log(`Owner: ${file.owners[0].displayName} (${file.owners[0].emailAddress})`);
        }
      } catch (error: any) {
        log.error(`Error retrieving file information: ${error.message}`);
      }
    });
    
    program.parse();
  } catch (error: any) {
    log.error(`Error: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

main();
