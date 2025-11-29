
import puppeteer from 'puppeteer';
import { LoginOptions } from './models.js';
import { getOrLaunchBrowser, readIonApiConfig, waitForMneCookies, writeCookiesToFile } from './utils.js';
import { readConfig } from '../../utils.js';

const WINDOW_WIDTH = 500;
const WINDOW_HEIGHT = 600;

export async function loginCloud({ ionApiConfig }: LoginOptions) {
   const { tenant } = readIonApiConfig(ionApiConfig);
   const odinConfig = readConfig();

   const browser = await getOrLaunchBrowser({
      headless: false,
      args: [
         `--app=${odinConfig.portalUrl}/${tenant}`,
         `--window-size=${WINDOW_WIDTH},${WINDOW_HEIGHT}`,
      ],
      defaultViewport: {
         width: WINDOW_WIDTH,
         height: WINDOW_HEIGHT,
      },
   });
   let page = (await browser.pages())[0];
   if (!page) {
      page = await browser.newPage();
   }
   
   // If we connected to remote Chrome, navigate to the portal URL
   // (since --app flag doesn't work when connecting to existing browser)
   const portalUrl = `${odinConfig.portalUrl}/${tenant}`;
   if (page.url() !== portalUrl) {
      console.log('Navigating to Portal URL:', portalUrl);
      await page.goto(portalUrl, { waitUntil: 'networkidle2' });
   }
   await page.waitForSelector("portal-root", { visible: true, timeout: 0 });

   await page.goto(`${odinConfig.m3Url}/mne`);
   const cookies = await waitForMneCookies(page);
   writeCookiesToFile(cookies);
   console.log("Got M3 session cookie");

   // if (options.updateConfig) {
   //    console.log('Updating odin.json');
   //    updateOdinConfig(config, options.m3Url);
   //    console.log('odin.json has been updated');
   // }

   await browser.close();

   console.log('Login successful! You can now run "odin serve --multi-tenant"');
}

