import fs from 'fs-extra';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import webpack from 'webpack';
import WebpackDevServer from 'webpack-dev-server';
import { executeAngularCli, isAngularProject, readConfig } from '../utils.js';
import { baseConfig } from './webpack.config.js';

const require = createRequire(import.meta.url);

/**
 * Gets the file watching polling interval from environment variable or uses default
 */
function getPollingInterval(): number | undefined {
   const pollEnv = process.env.ODIN_POLLING_INTERVAL;
   if (pollEnv) {
      const interval = parseInt(pollEnv, 10);
      if (!isNaN(interval) && interval > 0) {
         return interval;
      }
      console.warn(`Invalid ODIN_POLLING_INTERVAL value "${pollEnv}", using default 2000`);
   }
   // Default to 2000ms if not set (useful for container environments)
   return 2000;
}

export interface IServeOptions {
   port: number;
   multiTenant: boolean;
   ionApi: boolean;
}

async function serveBasicProject(options: IServeOptions) {
   const pollingInterval = getPollingInterval();
   const configWithDevServerEntry = addWebpackClientEntry(baseConfig, options.port);
   
   // Add watchOptions with polling for file watching (useful in container environments)
   if (pollingInterval) {
      configWithDevServerEntry.watchOptions = {
         poll: pollingInterval,
         aggregateTimeout: 300,
         ignored: /node_modules/,
      };
   }
   
   const webpackCompiler = webpack(configWithDevServerEntry);
   const odinConfig = readConfig();
   delete odinConfig.projectName; // TODO: webpack-dev-server does not allow additional properties. Find another place to store projectName.
   const devServerConfig: WebpackDevServer.Configuration = odinConfig;
   const server = new WebpackDevServer(webpackCompiler, {
      ...devServerConfig,
   });
   console.log(`Server is starting. Go to http://localhost:${options.port} in your browser.`);
   if (pollingInterval) {
      console.log(`File watching polling enabled with interval: ${pollingInterval}ms`);
   }
   await new Promise<void>((resolvePromise, rejectPromise) => {
      server.listen(options.port, "0.0.0.0", (error?: Error) => {
         if (error) {
            console.error('Failed to start Webpack Dev Server', error);
            rejectPromise(error);
         } else {
            resolvePromise();
         }
      });
   });
}

async function serveAngularProject(options: IServeOptions) {
   const proxyConfig = readConfig().proxy;
   if (!isProxyConfig(proxyConfig)) {
      throw new Error('Proxy config is invalid.');
   }
   const proxyFile = prepareProxyFile(proxyConfig, options);
   const proxyTmpPath = path.resolve(os.tmpdir(), proxyFile.name);
   const fileContent = proxyFile.content;
   fs.writeFileSync(proxyTmpPath, fileContent);
   
   const pollingInterval = getPollingInterval();
   const angularCliArgs: string[] = ['--port', `${options.port}`, '--host', '0.0.0.0', '--proxy-config', proxyTmpPath];
   
   // Add polling flag for Angular CLI if polling is enabled
   if (pollingInterval) {
      angularCliArgs.push('--poll', `${pollingInterval}`);
      console.log(`File watching polling enabled with interval: ${pollingInterval}ms`);
   }
   
   await executeAngularCli('serve', ...angularCliArgs);
}

/**
 * Start the development server.
 *
 * NOTE: This function will never return.
 */
export async function serveProject(options: IServeOptions) {
   if (isAngularProject()) {
      await serveAngularProject(options);
   } else {
      await serveBasicProject(options);
   }
}

function prepareProxyFile(proxyConfig: ProxyConfig, options: IServeOptions) {
   setHeaders('/mne');
   setHeaders('/m3api-rest');
   setHeaders('/ca');
   setHeaders('/ODIN_DEV_TENANT');
   if (options.multiTenant) {
      return multiTenantProxyFile(proxyConfig, options.ionApi);
   } else {
      return standardProxyFile(proxyConfig);
   }

   function setHeaders(apiPath: string) {
      const pathConfig = proxyConfig[apiPath];
      if (typeof pathConfig === 'object') {
         const target = pathConfig.target;
         if (target) {
            pathConfig.headers = {
               Origin: target.toString(),
               Referer: `${target}/odin-dev-proxy`,
               ...pathConfig.headers,
            };
         } else {
            console.warn(`Cannot set headers in config for '${apiPath}' since it has no target.`);
         }
      } else {
         console.warn(`Cannot set headers in config for '${apiPath}' since it is not an object.`);
      }
   }
}

function multiTenantProxyFile(proxyConfig: ProxyConfig, useIonApi?: boolean) {
   addMneProxyPlaceholders('/mne');
   if (useIonApi) {
      addIonProxyPlaceholders('/m3api-rest');
      addIonProxyPlaceholders('/ca');
      addIonProxyPlaceholders('/ODIN_DEV_TENANT');
      rewritePath('/m3api-rest', '/M3/m3api-rest');
      rewritePath('/ca', '/IDM');
   } else {
      addMneProxyPlaceholders('/m3api-rest');
      addMneProxyPlaceholders('/ca');
   }

   const mtToolContent = fs.readFileSync(require.resolve('../mtauth.cjs')).toString();
   const configContent = JSON.stringify(proxyConfig)
      .replace(/\"ODIN_MT_SET_MNE_COOKIES\"/g, 'function (...args) { authenticator.setMNECookies(...args) }')
      .replace(/\"ODIN_MT_SET_ION_API_TOKEN\"/g, 'function (...args) { authenticator.setIONAPIToken(...args) }')
      .replace(/\"ODIN_MT_CHECK_ION_API_AUTHENTICATION\"/g, 'function (...args) { authenticator.checkIONAPIAuthentication(...args) }')
      .replace(/\"ODIN_MT_ON_ERROR\"/g, 'function (...args) { authenticator.onError(...args) }');
   const fileContent = mtToolContent.replace(/CONFIG_PLACEHOLDER/, configContent);
   return { content: fileContent, name: 'odin_proxy.js' };

   function rewritePath(originalPath: string, newPath: string) {
      const pathConfig = proxyConfig[originalPath];
      const pattern = `^${originalPath}`;
      if (typeof pathConfig !== 'string' && !pathConfig.pathRewrite) {
         pathConfig.pathRewrite = { [pattern]: newPath };
      }
   }

   function addIonProxyPlaceholders(apiPath: string) {
      Object.assign(proxyConfig[apiPath], {
         onProxyReq: 'ODIN_MT_SET_ION_API_TOKEN',
         onProxyRes: 'ODIN_MT_CHECK_ION_API_AUTHENTICATION',
         onError: 'ODIN_MT_ON_ERROR',
      });
   }

   function addMneProxyPlaceholders(apiPath: string) {
      Object.assign(proxyConfig[apiPath], {
         onProxyReq: 'ODIN_MT_SET_MNE_COOKIES',
         onError: 'ODIN_MT_ON_ERROR',
      });
   }
}

function standardProxyFile(proxyConfig: ProxyConfig) {
   return { content: JSON.stringify(proxyConfig), name: 'odin_proxy.json' };
}

type PossibleProxyConfig = WebpackDevServer.ProxyConfigMap | WebpackDevServer.ProxyConfigArray | WebpackDevServer.ProxyConfigArrayItem | undefined;
type ProxyConfig = WebpackDevServer.ProxyConfigMap;
function isProxyConfig(proxy: PossibleProxyConfig): proxy is ProxyConfig {
   return proxy !== undefined && !Array.isArray(proxy);
}

/**
 * Add an entry for the Webpack Dev Server client in the given webpack config.
 * This is needed for live-reloading
 */
function addWebpackClientEntry(config: webpack.Configuration, port: number): webpack.Configuration {
   const clientAddress = `http://localhost:${port}`;
   const webpackClientEntry = `${require.resolve('webpack-dev-server/client')}?${clientAddress}`;
   const newConfig = { ...config };
   if (typeof newConfig.entry === 'string') {
      newConfig.entry = [newConfig.entry, webpackClientEntry];
   } else if (Array.isArray(newConfig.entry)) {
      newConfig.entry = [...newConfig.entry, webpackClientEntry];
   }
   return newConfig;
}
