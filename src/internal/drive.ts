/**
 * Extract file ID from Google Drive URL
 */
export function extractFileIdFromUrl(url: string): string | null {
  // Handle URLs like https://drive.google.com/file/d/{fileId}/view?usp=drive_link
  const fileRegex = /\/file\/d\/([a-zA-Z0-9_-]+)/;
  const fileMatch = url.match(fileRegex);
  if (fileMatch && fileMatch[1]) {
    return fileMatch[1];
  }

  // Handle URLs like https://drive.google.com/open?id={fileId}
  const openRegex = /[?&]id=([a-zA-Z0-9_-]+)/;
  const openMatch = url.match(openRegex);
  if (openMatch && openMatch[1]) {
    return openMatch[1];
  }

  // Handle URLs like https://docs.google.com/document/d/{fileId}/edit
  const docsRegex = /\/d\/([a-zA-Z0-9_-]+)/;
  const docsMatch = url.match(docsRegex);
  if (docsMatch && docsMatch[1]) {
    return docsMatch[1];
  }

  return null;
}
