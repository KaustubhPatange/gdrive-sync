import fs from 'fs'
import log from './log'
import JSON5 from 'json5';

export interface Config {
  loginType?: 'service' | 'oauth';
  serviceAccount?: string;
  oauth?: {
    clientId: string;
    clientSecret: string;
    tokens?: {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
      token_type?: string;
      expiry_date?: number;
    };
  };
}

/**
 * Parse config from JSON5 file
 */
export function parseConfig(configPath: string): Config {
  try {
    if (!fs.existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }
    
    const fileContent = fs.readFileSync(configPath, 'utf8');
    return JSON5.parse(fileContent);
  } catch (error) {
    log.error(`Failed to parse configuration: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Save updated config with tokens to file
 */
export function saveConfig(configPath: string, config: Config): void {
  try {
    const configStr = JSON5.stringify(config, { space: 2, quote: "'" });
    fs.writeFileSync(configPath, configStr);
    log.info('Updated configuration with new tokens');
  } catch (error) {
    log.warning(`Failed to save tokens: ${(error as Error).message}`);
  }
}

