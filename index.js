const fs = require('fs');
const path = require('path');
const tar = require('tar');
const crypto = require('crypto');
const { google } = require('googleapis');
const chalk = require('chalk');
require('dotenv').config(); // load .env variables

// Load from environment
const SERVICE_ACCOUNT_JSON = process.env.SERVICE_ACCOUNT_JSON;
const FOLDER_TO_BACKUP = process.env.FOLDER_TO_BACKUP || '/data';
const GDRIVE_FOLDER_NAME = process.env.GDRIVE_FOLDER_NAME || 'VaultWarden';
const MAX_BACKUPS = parseInt(process.env.MAX_BACKUPS || '5', 10);
const SYNC_MODE = process.env.SYNC_MODE === 'true' || false;

const HASH_FILENAME = '.last_backup_hash';
const BACKUP_FILENAME = getBackupFilename();

function getBackupFilename() {
  const now = new Date();
  const isoString = now.toISOString().replace(/:/g, '-').replace(/\..+/, '');
  return `backup-${isoString}.tar.gz`;
}

// Logger with chalk colors
const log = {
  info: (message) => console.log(chalk.blue('ℹ ') + chalk.cyan(message)),
  success: (message) => console.log(chalk.green('✓ ') + message),
  warning: (message) => console.log(chalk.yellow('⚠ ') + message),
  error: (message) => console.error(chalk.red('✗ ') + chalk.redBright(message)),
  highlight: (message) => console.log(chalk.magenta('→ ') + chalk.bold(message)),
  process: (message) => console.log(chalk.blue('⚙ ') + chalk.white(message))
};

// Validate environment variables
if (!SERVICE_ACCOUNT_JSON || !FOLDER_TO_BACKUP) {
  log.error('Missing required environment variables.');
  process.exit(1);
}

// Authenticate
async function authenticate() {
  const credentials = JSON.parse(SERVICE_ACCOUNT_JSON);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  return google.drive({ version: 'v3', auth });
}

// Create tar.gz backup
async function createBackup() {
  log.process('Creating backup archive...');
  await tar.c(
    {
      gzip: true,
      file: BACKUP_FILENAME,
      cwd: path.dirname(FOLDER_TO_BACKUP),
    },
    [path.basename(FOLDER_TO_BACKUP)]
  );
  log.success(`Backup created: ${chalk.bold(BACKUP_FILENAME)}`);
}

// Find or create VaultWarden folder
async function getVaultWardenFolderId(drive) {
  log.process('Looking for VaultWarden folder...');
  const res = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${GDRIVE_FOLDER_NAME}' and trashed=false`,
    fields: 'files(id, name)',
  });

  if (res.data.files.length > 0) {
    log.success('VaultWarden folder found.');
    return res.data.files[0].id;
  }

  log.info('Creating VaultWarden folder...');
  const folder = await drive.files.create({
    resource: {
      name: GDRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });
  log.success('VaultWarden folder created.');
  return folder.data.id;
}

// Upload backup to Drive
async function uploadBackup(drive, folderId) {
  log.process('Uploading backup to Google Drive...');
  const fileMetadata = {
    name: BACKUP_FILENAME,
    parents: [folderId],
  };

  const media = {
    mimeType: 'application/gzip',
    body: fs.createReadStream(BACKUP_FILENAME),
  };

  const res = await drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id',
  });

  log.success(`Backup uploaded. File ID: ${chalk.dim(res.data.id)}`);
}

// Delete old backups (keep only latest MAX_BACKUPS)
async function deleteOldBackups(drive, folderId) {
  log.process('Checking for old backups to delete...');
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed=false and name != '${HASH_FILENAME}'`,
    fields: 'files(id, name, createdTime)',
    orderBy: 'createdTime desc',
  });

  const files = res.data.files;
  if (files.length <= MAX_BACKUPS) {
    log.info('No old backups to delete.');
    return;
  }

  const oldFiles = files.slice(MAX_BACKUPS);
  for (const file of oldFiles) {
    await drive.files.delete({ fileId: file.id });
    log.success(`Deleted old backup: ${chalk.dim(file.name)}`);
  }
}

// Calculate hash of a directory
async function calculateDirectoryHash(directory) {
  log.process('Calculating directory hash...');
  const hash = crypto.createHash('sha256');

  // Function to recursively process files
  async function processDirectory(dir) {
    const files = fs.readdirSync(dir).sort(); // Sort for consistent order

    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        await processDirectory(fullPath);
      } else {
        // Skip the hash file itself if it exists locally
        if (file === HASH_FILENAME) continue;

        const fileContent = fs.readFileSync(fullPath);
        const relativePath = path.relative(directory, fullPath);
        hash.update(`${relativePath}:${stat.size}:${stat.mtimeMs}`);
        hash.update(fileContent);
      }
    }
  }

  await processDirectory(directory);
  return hash.digest('hex');
}

// Get hash file from Google Drive
async function getHashFileFromDrive(drive, folderId) {
  log.process('Retrieving hash file from Google Drive...');
  const res = await drive.files.list({
    q: `'${folderId}' in parents and name='${HASH_FILENAME}' and trashed=false`,
    fields: 'files(id, name)',
  });

  if (res.data.files.length === 0) {
    log.info('No hash file found on Google Drive.');
    return { exists: false };
  }

  const fileId = res.data.files[0].id;
  const response = await drive.files.get({
    fileId: fileId,
    alt: 'media'
  });

  log.success('Hash file retrieved from Google Drive.');
  return {
    exists: true,
    hash: response.data,
    fileId: fileId
  };
}

// Upload hash file to Google Drive
async function uploadHashFile(drive, folderId, hash, existingFileId = null) {
  // Write hash to local file first
  fs.writeFileSync(HASH_FILENAME, hash);

  const media = {
    mimeType: 'text/plain',
    body: fs.createReadStream(HASH_FILENAME),
  };

  if (existingFileId) {
    // Update existing file
    log.process('Updating hash file on Google Drive...');
    await drive.files.update({
      fileId: existingFileId,
      media: media
    });
    log.success('Hash file updated on Google Drive.');
  } else {
    // Create new file
    log.process('Creating new hash file on Google Drive...');
    const fileMetadata = {
      name: HASH_FILENAME,
      parents: [folderId],
    };

    await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id',
    });
    log.success('Hash file uploaded to Google Drive.');
  }

  // Clean up local hash file
  fs.unlinkSync(HASH_FILENAME);
}

// Get latest backup from Google Drive
async function getLatestBackup(drive, folderId) {
  log.process('Looking for latest backup on Google Drive...');
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/gzip' and trashed=false`,
    fields: 'files(id, name, createdTime)',
    orderBy: 'createdTime desc',
    pageSize: 1
  });

  if (res.data.files.length === 0) {
    log.warning('No backups found on Google Drive.');
    return null;
  }

  const latestBackup = res.data.files[0];
  log.success(`Latest backup found: ${chalk.bold(latestBackup.name)}`);
  return latestBackup;
}

// Download backup from Google Drive
async function downloadBackup(drive, fileId, filename) {
  log.process(`Downloading backup from Google Drive...`);
  const dest = fs.createWriteStream(filename);

  const response = await drive.files.get({
    fileId: fileId,
    alt: 'media'
  }, { responseType: 'stream' });

  return new Promise((resolve, reject) => {
    response.data
      .on('error', err => {
        reject(err);
      })
      .pipe(dest)
      .on('finish', () => {
        log.success(`Backup downloaded: ${chalk.bold(filename)}`);
        resolve();
      })
      .on('error', err => {
        reject(err);
      });
  });
}

// Extract backup
async function extractBackup(filename, targetDir) {
  log.process(`Extracting backup to ${chalk.bold(targetDir)}...`);
  // Ensure target directory exists
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  await tar.x({
    file: filename,
    cwd: path.dirname(targetDir)
  });

  log.success(`Backup extracted to ${chalk.bold(targetDir)}`);
}

// Main
async function main() {
  try {
    log.highlight(`Starting ${SYNC_MODE ? 'sync' : 'backup'} process...`);
    const drive = await authenticate();
    log.success('Successfully authenticated to Google Drive.');

    const folderId = await getVaultWardenFolderId(drive);

    if (SYNC_MODE) {
      log.highlight('Running in sync mode...');

      // Check if folder is empty
      const folderExists = fs.existsSync(FOLDER_TO_BACKUP);
      const isEmpty = folderExists && fs.readdirSync(FOLDER_TO_BACKUP).length === 0;

      if (!folderExists || isEmpty) {
        log.warning('Folder is empty or does not exist. Downloading latest backup...');
        const latestBackup = await getLatestBackup(drive, folderId);

        if (latestBackup) {
          const tempBackupFile = `temp-${latestBackup.name}`;
          await downloadBackup(drive, latestBackup.id, tempBackupFile);
          await extractBackup(tempBackupFile, FOLDER_TO_BACKUP);
          fs.unlinkSync(tempBackupFile);
          log.success('Restored from latest backup.');
        } else {
          log.warning('No backups available. Creating empty folder.');
          if (!folderExists) {
            fs.mkdirSync(FOLDER_TO_BACKUP, { recursive: true });
          }
        }
      }

      // Calculate current folder hash
      log.info('Calculating folder hash...');
      const currentHash = await calculateDirectoryHash(FOLDER_TO_BACKUP);
      log.info(`Current folder hash: ${chalk.dim(currentHash)}`);

      // Get hash file from Google Drive
      const hashFile = await getHashFileFromDrive(drive, folderId);

      if (!hashFile.exists || hashFile.hash !== currentHash) {
        log.highlight('Changes detected. Creating new backup...');
        await createBackup();
        await uploadBackup(drive, folderId);
        await uploadHashFile(drive, folderId, currentHash, hashFile.exists ? hashFile.fileId : null);
        await deleteOldBackups(drive, folderId);

        // Delete local backup after upload
        fs.unlinkSync(BACKUP_FILENAME);
        log.success(`Local backup ${chalk.bold(BACKUP_FILENAME)} deleted.`);
      } else {
        log.success('No changes detected. Skipping backup.');
      }
    } else {
      // Original backup functionality
      log.highlight('Running in backup mode...');
      await createBackup();
      await uploadBackup(drive, folderId);
      await deleteOldBackups(drive, folderId);

      // Delete local backup after upload
      fs.unlinkSync(BACKUP_FILENAME);
      log.success(`Local backup ${chalk.bold(BACKUP_FILENAME)} deleted.`);
    }

    log.highlight('Backup process completed successfully.');
  } catch (error) {
    log.error(`Error: ${error.message}`);
    if (error.stack) {
      console.error(chalk.dim(error.stack));
    }
  }
}

main();
