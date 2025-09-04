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
