import * as readline from 'readline';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { parseConfig, saveConfig, Config } from './config'
import log from './log'

/**
 * Extract OAuth code from URL
 */
function extractOAuthCodeFromUrl(url: string): string | null {
  const codeRegex = /[?&]code=([^&]+)/;
  const codeMatch = url.match(codeRegex);
  if (codeMatch && codeMatch[1]) {
    return decodeURIComponent(codeMatch[1]);
  }
  return null;
}


/**
 * Authenticate with Google Drive API using service account
 */
async function authenticateService(serviceAccountJson: string) {
  try {
    const credentials = JSON.parse(serviceAccountJson);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    return google.drive({ version: 'v3', auth });
  } catch (error) {
    log.error('Service account authentication failed. Check your SERVICE_ACCOUNT_JSON.');
    throw error;
  }
}

/**
 * Authenticate with Google Drive API using OAuth
 */
async function authenticatePersonal(clientId: string, clientSecret: string, tokens?: any, configPath?: string, config?: Config) {
  try {
    const redirectUri = 'http://localhost:8080';
    
    const oauth2Client = new OAuth2Client(
      clientId,
      clientSecret,
      redirectUri
    );

    if (tokens && tokens.refresh_token) {
      log.info('Using saved OAuth tokens');
      oauth2Client.setCredentials(tokens);
      
      oauth2Client.on('tokens', (newTokens) => {
        const updatedTokens = {
          ...tokens,
          ...newTokens
        };
        
        if (config && config.oauth && configPath) {
          config.oauth.tokens = updatedTokens;
          saveConfig(configPath, config);
        }
      });
      
      try {
        const drive = google.drive({ version: 'v3', auth: oauth2Client });
        await drive.about.get({ fields: 'user' });
        log.success('Successfully authenticated with saved tokens');
        return drive;
      } catch (error) {
        log.warning('Saved tokens are invalid or expired. Starting new authentication flow.');
      }
    }

    const scopes = [
      'https://www.googleapis.com/auth/drive'
    ];

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });

    console.log('\n🔐 Authorization required:');
    console.log('1. Open this URL in your browser:');
    console.log(`\n${authUrl}\n`);
    console.log('2. After authorization, you\'ll be redirected to localhost:8080');
    console.log('3. Copy the entire URL or just the "code" parameter');
    console.log('   Example: http://localhost:8080/?code=YOUR_CODE_HERE');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const userInput = await new Promise<string>((resolve) => {
      rl.question('📝 Paste the URL or code here: ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });

    let code = userInput;
    
    if (userInput.includes('localhost:8080') || userInput.includes('?code=')) {
      const extractedCode = extractOAuthCodeFromUrl(userInput);
      if (extractedCode) {
        code = extractedCode;
        log.info('Successfully extracted code from URL');
      } else {
        log.warning('Could not extract code from URL, using input as-is');
      }
    }

    const { tokens: newTokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(newTokens);

    if (config && config.oauth && configPath) {
      config.oauth.tokens = newTokens as any;
      saveConfig(configPath, config);
    }

    oauth2Client.on('tokens', (refreshedTokens) => {
      const updatedTokens = {
        ...newTokens,
        ...refreshedTokens
      };
      
      if (config && config.oauth && configPath) {
        config.oauth.tokens = updatedTokens as any;
        saveConfig(configPath, config);
      }
    });

    console.log('✅ Authentication successful!');
    return google.drive({ version: 'v3', auth: oauth2Client });
    
  } catch (error) {
    console.error('OAuth authentication failed:', error);
    throw error;
  }
}

/**
 * Main authentication function that handles both service account and OAuth
 */
export async function authenticate(configPath: string) {
  const config = parseConfig(configPath);
  
  if (config.loginType === 'service' && config.serviceAccount) {
    log.info('Authenticating with service account (explicit choice)...');
    return await authenticateService(config.serviceAccount);
  } 
  else if (config.loginType === 'oauth' && config.oauth?.clientId && config.oauth?.clientSecret) {
    log.info('Authenticating with OAuth (explicit choice)...');
    return await authenticatePersonal(
      config.oauth.clientId, 
      config.oauth.clientSecret, 
      config.oauth.tokens,
      configPath,
      config
    );
  }
  else if (config.serviceAccount && !config.loginType) {
    log.info('Authenticating with service account...');
    return await authenticateService(config.serviceAccount);
  }
  else if (config.oauth?.clientId && config.oauth?.clientSecret && !config.loginType) {
    log.info('Authenticating with OAuth...');
    return await authenticatePersonal(
      config.oauth.clientId, 
      config.oauth.clientSecret, 
      config.oauth.tokens,
      configPath,
      config
    );
  }
  else {
    throw new Error('Invalid configuration. Please provide either serviceAccount or oauth credentials.');
  }
}
