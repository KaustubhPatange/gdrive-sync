# Google Drive Backup & Sync

A powerful Node.js utility for backing up and synchronizing folders to Google Drive.

<p align="center">
  <img src="assets/screenshot2.png" />
</p>

## Features

- Backup folders to Google Drive
- Smart sync mode with change detection
- Automatic cleanup of old backups
- Secure authentication with service accounts
- Command-line tools for file operations

## Installation

```bash
npm install @kp2016/gdrive-sync
```

```bash
gdown --help
sync-compress --help
```

## Tools

This package provides two main command-line tools:

### 1. gdown

A versatile tool for Google Drive operations:

- Upload files and folders
- Download files and folders
- List files in a folder
- Get file information

### 2. sync-compress

A specialized tool for backup and synchronization:

- Creates compressed backups of folders
- Maintains a specified number of recent backups
- Detects changes using SHA-256 hashing
- Restores from latest backup when needed

## Setup Guide

### Google Drive API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Drive API:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google Drive API"
   - Click "Enable"
4. Create a Service Account:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "Service Account"
   - Fill in the required details
5. Generate Key:
   - Open the created service account
   - Go to "Keys" tab
   - Add new key > Create new key > JSON
   - Download the key file
6. Share Drive Folder:
   - Create a folder in Google Drive
   - Share it with the service account email
   - Give "Editor" access

### Configuration



## Usage

### gdown

Create a `config.json5` file with the following settings:

```json5
{
  // Authentication type: 'service' or 'oauth'
  "loginType": "service",
  
  // Path to service account JSON file (for service account auth)
  "serviceAccount": "./service-account.json",
  
  // OAuth settings (for OAuth authentication)
  "oauth": {
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret"
  }
}
```

```bash
# Upload a file
gdown upload path/to/file.txt --folder FOLDER_ID_or_URL --config config.json5

# Upload a folder content with only files that are changed by hash
gdown upload path/to/folder --folder FOLDER_ID_or_URL --config config.json5 --track

# Download a file
gdown download FILE_ID_OR_URL --output path/to/save --config config.json5

# List files in a folder
gdown list --folder "My Folder" --config config.json5

# Get file information
gdown info FILE_ID_OR_URL --config config.json5
```

### sync-compress

Create a `.env` file or export following variables:

```env
# Google Drive API credentials (paste your service account JSON here)
SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"your-project-id","private_key_id":"your-key-id","private_key":"your-private-key","client_email":"your-service-account@your-project.iam.gserviceaccount.com"}'

# Path to backup folder
FOLDER_TO_BACKUP='/path/to/folder'

# Name of the backup folder in Google Drive
GDRIVE_FOLDER_NAME='Backups'

# Maximum number of backups to keep
MAX_BACKUPS='5'

# Enable sync mode (optional)
# SYNC_MODE='true'
```

```bash
# Run backup with environment variables
node sync-compress.js
```

#### Operation Modes

- ##### Backup Mode (Default)
  - Creates a new backup on each run
  - Maintains the specified number of recent backups
  - Automatically removes older backups

- ##### Sync Mode
    - Enable by setting `SYNC_MODE='true'`
    - Only creates backups when changes are detected
    - Uses SHA-256 hashing for change detection
    - Restores from latest backup if target folder is empty

#### Best Practices
- Keep your service account credentials secure
- Test the backup and restore process
- Use cron jobs for scheduled backups
- Monitor the backup logs

#### Example Cron Job

Add this to your `crontab -e` for daily backups at 2 AM:
```bash
0 2 * * * cd /path/to/app && node sync-compress.js
```

## License

```
MIT License

Copyright (c) 2025 Kaustubh Patange

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
