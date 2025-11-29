import dns from 'dns';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import puppeteer from 'puppeteer';
import { ProxyConfigMap } from 'webpack-dev-server';
import { Cookie, IonApiConfig, RawIonApiConfig, Token } from './models.js';
import { readConfig, writeConfig } from '../../utils.js';

export function urlJoin(...segments: string[]): string {
  return segments.map(segment => segment.replace(/(^\/|\/$)/g, '')).join('/');
}

/**
 * Gets the Docker host IP address by resolving 'host.docker.internal'
 * Returns null if not in a Docker environment or resolution fails
 */
async function getDockerHostIP(): Promise<string | null> {
  try {
    const address = await dns.promises.lookup('host.docker.internal');
    return address.address;
  } catch (error) {
    // Not in Docker or host.docker.internal not available
    return null;
  }
}

/**
 * Gets the Chrome remote debugging port from environment variable or uses default
 */
function getChromeDebugPort(): number {
  const portEnv = process.env.CHROME_DEBUG_PORT;
  if (portEnv) {
    const port = parseInt(portEnv, 10);
    if (!isNaN(port) && port > 0 && port < 65536) {
      return port;
    }
    console.warn(`Invalid CHROME_DEBUG_PORT value "${portEnv}", using default 9222`);
  }
  return 9222;
}

/**
 * Attempts to get the Chrome WebSocket debugger endpoint from remote Chrome
 * Returns null if remote Chrome is not available
 */
async function getBrowserWebSocketEndpoint(hostIP: string, port: number): Promise<string | null> {
  try {
    const response = await fetch(`http://${hostIP}:${port}/json/version`, {
      signal: AbortSignal.timeout(2000), // 2 second timeout
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data.webSocketDebuggerUrl || null;
  } catch (error) {
    // Remote Chrome not available
    return null;
  }
}

/**
 * Gets or launches a browser instance.
 * In devcontainer environments, attempts to connect to Chrome remote debugging on the host.
 * Falls back to launching a new browser instance if remote debugging is not available (only when not in container).
 */
export async function getOrLaunchBrowser(launchOptions: {
  headless?: boolean;
  args?: string[];
  defaultViewport?: { width: number; height: number };
}): Promise<puppeteer.Browser> {
  // Try to connect to remote Chrome (for devcontainer scenarios)
  const dockerHostIP = await getDockerHostIP();
  if (dockerHostIP) {
    const port = getChromeDebugPort();
    console.log(`Detected container environment. Attempting to connect to Chrome remote debugging on host at port ${port}...`);
    const webSocketEndpoint = await getBrowserWebSocketEndpoint(dockerHostIP, port);
    if (webSocketEndpoint) {
      try {
        const browser = await puppeteer.connect({
          browserWSEndpoint: webSocketEndpoint,
        });
        console.log('Successfully connected to remote Chrome');
        return browser;
      } catch (error) {
        throw new Error(
          `Failed to connect to Chrome remote debugging on host (${dockerHostIP}:${port}). ` +
          `Please ensure Chrome is running with remote debugging enabled: ` +
          `chrome --remote-debugging-port=${port} --user-data-dir=/tmp/chrome-debug. ` +
          `You can also set a custom port using the CHROME_DEBUG_PORT environment variable.`
        );
      }
    } else {
      throw new Error(
        `Chrome remote debugging is not available on host (${dockerHostIP}:${port}). ` +
        `Please ensure Chrome is running with remote debugging enabled: ` +
        `chrome --remote-debugging-port=${port} --user-data-dir=/tmp/chrome-debug. ` +
        `You can also set a custom port using the CHROME_DEBUG_PORT environment variable.`
      );
    }
  }

  // Launch new browser instance (default behavior when not in container)
  console.log('Launching new browser instance...');
  return await puppeteer.launch(launchOptions);
}

export function readIonApiConfig(configPath: string): IonApiConfig {
  const data: RawIonApiConfig = fs.readJSONSync(configPath);
  return new IonApiConfig(data);
}

export function updateOdinConfig(ionApiConfig: IonApiConfig, m3Url?: string) {
  const odinConfig = readConfig();
  const ionTarget = setTarget('/ODIN_DEV_TENANT', ionApiConfig.ionApiUrl);
  ionTarget.pathRewrite = { '^/ODIN_DEV_TENANT': '' };
  if (m3Url) {
    setTarget('/m3api-rest', m3Url);
    setTarget('/mne', m3Url);
    setTarget('/ca', m3Url);
  } else {
    setTarget('/m3api-rest', ionApiConfig.ionApiUrl);
  }
  writeConfig(odinConfig);

  function setTarget(proxyPath: string, target: string) {
    console.log(`Update target ${proxyPath} -> ${target}`);
    const config = getPathConfig(proxyPath);
    config.target = target;
    return config;
  }

  function getPathConfig(proxyPath: string) {
    if (odinConfig.proxy && !Array.isArray(odinConfig.proxy)) {
      const pathConfig = (odinConfig.proxy as ProxyConfigMap)[proxyPath];
      if (typeof pathConfig !== 'string') {
        return pathConfig;
      }
    }
    throw new Error(`Could not get proxy config for path ${proxyPath}`);
  }
}

export function writeTokenToFile(token: Token) {
  // File paths & content should match mtauth.ts
  const filePath = path.resolve(os.tmpdir(), 'authorizationheader.json');
  const content = {
    authorizationHeader: `${token.token_type} ${token.access_token}`,
    // expirationTimestamp: token.expires_in,
  };
  fs.writeJsonSync(filePath, content);
}

export function writeCookiesToFile(cookies: Cookie[]) {
  // File paths & content should match mtauth.ts
  const filePath = path.resolve(os.tmpdir(), 'cookieheader.json');
  const content = cookies.map(({ name, value }) => `${name}=${value};`).join(' ');
  fs.writeFileSync(filePath, content);
}


export async function waitForMneCookies(page: puppeteer.Page): Promise<Cookie[]> {
  return new Promise<Cookie[]>((resolvePromise, rejectPromise) => {
    const intervalId = setInterval(async () => {
      try {
        const cookies = await getAllCookies(page);
        const sessionCookie = cookies.find(mneSessionCookie);
        if (sessionCookie) {
          clearInterval(intervalId);
          resolvePromise(cookies);
        }
      } catch (error) {
        clearInterval(intervalId);
        rejectPromise(error);
      }
    }, 1000);
  });

  // TODO - type this: puppeteer.Page
  async function getAllCookies(_page: any): Promise<Cookie[]> {

    const getAllCookiesResponse = await _page
      ._client()
      .send("Network.getAllCookies");
    return getAllCookiesResponse.cookies;

  }

  function mneSessionCookie(cookie: Cookie) {
    return cookie.path === '/mne' && cookie.name === 'JSESSIONID';
  }
}
