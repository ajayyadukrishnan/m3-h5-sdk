import { urlJoin } from "./utils.js";
import puppeteer from 'puppeteer';

export interface RawIonApiConfig {
  /**
   * Tenant
   */
  ti: string;
  /**
   * Application name
   */
  cn: string;
  dt: string;
  /**
   * client_id
   */
  ci: string;
  /**
   * client_secret
   */
  cs: string;
  /**
   * ION API host
   */
  iu: string;
  /**
   * Auth provider URL
   */
  pu: string;
  /**
   * Authorization path
   */
  oa: string;
  ot: string;
  or: string;
  /**
   * redirect_uri
   */
  ru: string;
  ev: string;
  v: string;
}

export class IonApiConfig {
  constructor(private data: RawIonApiConfig) { }

  get tenant() {
    return this.data.ti;
  }

  get clientId() {
    return this.data.ci;
  }

  get redirectUri() {
    return this.data.ru;
  }

  get ionApiUrl() {
    return urlJoin(this.data.iu, this.tenant);
  }

  get authUrl() {
    const url = new URL(urlJoin(this.data.pu, this.data.oa));
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('response_type', 'token');
    return url.toString();
  }
}

export interface LoginOptions {
  ionApiConfig: string;
  m3Url?: string;
  updateConfig?: boolean;
}


export interface Token {
  access_token: string;
  token_type: string;
  expires_in: string;
}

/**
 * NOTE: This used to be puppeteer.Cookie
 */
export type Cookie = puppeteer.Protocol.Network.Cookie
