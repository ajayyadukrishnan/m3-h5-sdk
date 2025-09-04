#!/usr/bin/env node

import { program } from 'commander';
import fs from 'fs-extra';
import type { ConfirmQuestion, InputQuestion, ListQuestion } from 'inquirer';
import inquirer from 'inquirer';
import path from 'path';
import url from "url";
import { buildProject, INewProjectOptions, IServeOptions, login, newProject, serveProject, setConfiguration } from './commands/index.js';
import { isValidProxyUrl } from './utils.js';

// For __dirname in es module: https://blog.logrocket.com/alternatives-dirname-node-js-es-modules/
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

const versionNumber = fs.readJSONSync(path.join(__dirname, "../package.json")).version;

const exit = (message?: string, outputHelp = true) => {
   if (message) {
      console.error('ERROR:', message);
   }
   if (outputHelp) {
      program.outputHelp();
   }
   process.exit(1);
};

const wrapServe = async (options: IServeOptions) => {
   if (!fs.existsSync('odin.json')) {
      exit('Could not find an Odin configuration file.', false);
   }
   console.log('Starting Dev Server...');
   try {
      await serveProject(options);
   } catch (error) {
      console.error(error);
      exit('Serving was aborted because of an error', false);
   }
};

const wrapNew = async (options: INewProjectOptions) => {
   try {
      await newProject(options);
      console.log('Done!');
      console.log('To continue with the new project, install dependencies and start the server:');
      console.log('\tcd', options.name);
      console.log('\tnpm install');
      console.log('\todin serve');
   } catch (error) {
      console.error(error);
      exit('Failed to create new project', false);
   }
};

program
   .version(versionNumber)
   .name('odin')
   .description('Tool to set up and manage a web application with Odin.');

/**
 * Take raw commander inputs, validate CLI‐only bits
 * and return a partial “overrides” object.
 */
function buildCliOptions(projectName: string, opts: any) {
   const cli: any = {};

   if (projectName) {
      cli.name = projectName;
   }

   // style flag: soho => 'soho', explicitly --no-soho => 'none'
   if (opts.soho !== undefined) {
      cli.style = opts.soho ? 'soho' : 'none';
   }

   if (opts.angular !== undefined) {
      cli.angular = opts.angular;
   }

   if (opts.install !== undefined) {
      cli.install = opts.install;
   }

   if (opts.skipGit !== undefined) {
      cli.git = !opts.skipGit;
   }

   if (opts.proxy) {
      if (!isValidProxyUrl(opts.proxy)) {
         exit(
            `Proxy url '${opts.proxy}' is invalid.`
            + ` It should be protocol://hostname:port`
         );
      }
      cli.proxy = { target: opts.proxy };
   }

   if (opts.portal) {
      if (!isValidProxyUrl(opts.portal)) {
         exit(
            `Portal url '${opts.portal}' is invalid.`
            + ` It should be protocol://hostname`
         );
      }
      cli.portal = opts.portal;
   }

   return cli;
}

/**
 * Given a partial overrides object, prompt only
 * for the values that are still undefined.
 */
async function promptMissingOptions(overrides: any) {
   const questions = [];

   if (!overrides.name) {
      questions.push({
         type: 'input',
         name: 'name',
         message: 'What is the name of the project?',
         validate: (input: string) => {
            if (!/^[a-zA-Z0-9-]+$/.test(input)) {
               return 'Only letters, numbers and dashes are allowed.';
            }
            if (fs.existsSync(input)) {
               return 'That directory already exists.';
            }
            return true;
         }
      });
   }

   if (overrides.style === undefined) {
      questions.push({
         type: 'list',
         name: 'style',
         message: 'Which style library do you want to use?',
         choices: [
            { name: 'SoHo (Infor Design System)', value: 'soho' },
            { name: 'None', value: 'none' }
         ],
         default: 'soho'
      });
   }

   if (overrides.angular === undefined) {
      questions.push({
         type: 'confirm',
         name: 'angular',
         message: 'Use Angular CLI project structure?',
         default: true
      });
   }

   if (!overrides.proxy) {
      questions.push({
         type: 'input',
         name: 'proxy',
         message: 'What is the URL of your M3 environment?',
         default: 'https://m3prdxyz.m3.xyz.inforcloudsuite.com',
         validate: (url: string) =>
            isValidProxyUrl(url)
               ? true
               : 'Must be valid URL like: protocol://hostname:port'
      });
   }

   if (!overrides.portal) {
      questions.push({
         type: 'input',
         name: 'portal',
         message: 'What is the URL of your Portal environment?',
         default: 'https://mingle-xyz-portal.xyz.inforcloudsuite.com',
         validate: (url: string) =>
            isValidProxyUrl(url)
               ? true
               : 'Must be valid URL like: protocol://hostname'
      });
   }

   if (overrides.git === undefined) {
      questions.push({
         type: 'confirm',
         name: 'git',
         message: 'Initialize a Git repository?',
         default: true
      });
   }

   if (overrides.install === undefined) {
      questions.push({
         type: 'confirm',
         name: 'install',
         message: 'Install NPM dependencies? (this may take a while)',
         default: false
      });
   }

   const answers = questions.length
      ? await inquirer.prompt(questions)
      : {};

   // Merge CLI overrides + prompted answers
   return {
      name: overrides.name || answers.name,
      style: overrides.style || answers.style,
      angular:
         overrides.angular !== undefined
            ? overrides.angular
            : answers.angular,
      proxy:
         overrides.proxy ||
         { target: answers.proxy },
      portalUrl: overrides.portal !== undefined ? overrides.portal : answers.portal,
      git:
         overrides.git !== undefined
            ? overrides.git
            : answers.git,
      install:
         overrides.install !== undefined
            ? overrides.install
            : answers.install,
      m3Url: overrides.m3Url || answers.m3Url,
      tenant: overrides.tenant || answers.tenant
   };
}

// ─── CLI SETUP ────────────────────────────────────────────────────────────────
program
   .command('new [projectName]')
   .description('Create a new project')
   .option('-s, --soho', 'Set up as a Soho-styled project', undefined)
   .option('-a, --angular', 'Set up as an Angular CLI project', undefined)
   .option('-i, --install', 'Install NPM dependencies', undefined)
   .option('--skip-git', 'Skip initialization of a git repo', undefined)
   .option('-p, --proxy <url>', 'URL for M3 environment')
   .option('-po, --portal <url>', 'URL for Portal environment')
   .action(async (projectName, opts) => {
      try {
         const cliOverrides = buildCliOptions(projectName, opts);
         const fullOpts = await promptMissingOptions(cliOverrides);
         await wrapNew(fullOpts);
      } catch (err: any) {
         exit(err.message);
      }
   });

program
   .command('serve')
   .description('Start web server and builder')
   .option('-p, --port <port>', 'Port to listen on')
   .option('-m, --multi-tenant', 'Enable Multi-Tenant proxy')
   .option('-i, --ion-api', 'Use ION API for Multi-Tenant proxy requests')
   .action(async (options) => {
      await wrapServe({
         port: options.port || 8080,
         multiTenant: Boolean(options.multiTenant),
         ionApi: Boolean(options.ionApi),
      });
   });

program
   .command('login <ionApiConfigPath>')
   .option('--m3 <m3Url>', 'URL to M3')
   .option('-c, --update-config', 'Update odin.json configuration')
   .description('Multi-Tenant login')
   .action(async (ionApiConfig: string, options) => {
      try {
         await login({
            ionApiConfig,
            m3Url: options.m3,
            updateConfig: options.updateConfig,
         });
      } catch (error) {
         console.error(error);
         exit('Login command failed');
      }
   });

program
   .command('build')
   .description('Build a production-ready application')
   .action(() => {
      if (!fs.existsSync('odin.json')) {
         exit('Could not find an Odin configuration file.', false);
      }
      console.log('Building project...');
      buildProject().then(() => {
         console.log('Project built successfully');
      }).catch(error => {
         console.error('Build failed:', error);
      });
   });

program
   .command('set <key> <value>')
   .description('Configure an existing project. Valid configuration keys are: name, m3-proxy, ion-proxy')
   .action((key: string, value: string) => {
      try {
         setConfiguration(key, value);
      } catch (error) {
         console.error(error);
         exit('Configuration failed', false);
      }
   });

const inquireNewProject = async () => {
   const nameQuestion: InputQuestion = {
      name: 'projectName',
      type: 'input',
      message: 'What is the name of the project?',
      validate: (name) => {
         if (name.match(/^[a-zA-Z0-9-]+$/) === null) {
            return 'The project name can only have letters, numbers and dashes';
         } else if (fs.existsSync(name)) {
            return 'The directory already exists.';
         } else {
            return true;
         }
      }
   };
   const proxyQuestion: InputQuestion = {
      name: 'proxy',
      type: 'input',
      message: 'What is the URL of your M3 environment?',
      default: 'https://example.com:8080',
      validate: (input) => {
         if (!isValidProxyUrl(input)) {
            return 'The URL must look like the following: protocol://hostname:port';
         } else {
            return true;
         }
      }
   };
   const frameworkQuestion: ListQuestion = {
      name: 'framework',
      type: 'list',
      message: 'Which view framework do you want to use?',
      choices: [
         {
            name: 'Angular',
            value: 'angular',
         },
         {
            name: 'None',
            value: 'none',
         },
      ],
      default: 'angular'
   };
   const styleQuestion: ListQuestion = {
      name: 'style',
      type: 'list',
      message: 'Which style library do you want to use?',
      choices: [
         {
            name: 'SoHo (Infor Design System)',
            value: 'soho',
         },
         {
            name: 'None',
            value: 'none',
         },
      ],
      default: 'soho'
   };
   const gitQuestion: ConfirmQuestion = {
      name: 'git',
      type: 'confirm',
      message: 'Should Git be used for the project?',
      default: true,
   };
   const installQuestion: ConfirmQuestion = {
      name: 'install',
      type: 'confirm',
      message: 'Should dependencies be installed? This can take a while.',
      default: false
   };
   const answers = await inquirer.prompt([
      nameQuestion,
      frameworkQuestion,
      styleQuestion,
      proxyQuestion,
      gitQuestion,
      installQuestion,
   ]);
   const newProjectOptions: INewProjectOptions = {
      name: answers.projectName,
      style: answers.style,
      angular: answers.framework === 'angular',
      proxy: {
         target: answers.proxy,
      },
      install: answers.install,
      git: answers.git,
   };
   await wrapNew(newProjectOptions);
};

const inquireServeProject = async () => {
   const portQuestion: InputQuestion = {
      name: 'port',
      type: 'input',
      default: '8080',
      message: 'Which port should be used?',
      validate: (port) => {
         if (port.match(/^\d+$/) === null) {
            return 'The port must be a number, e.g 8080';
         } else {
            return true;
         }
      }
   };
   const mtQuestion: ConfirmQuestion = {
      name: 'multiTenant',
      type: 'confirm',
      default: false,
      message: 'Enable Multi-Tenant proxy?'
   };
   const ionQuestion: ConfirmQuestion = {
      name: 'ionApi',
      type: 'confirm',
      default: false,
      when: (previousAnswers => Boolean(previousAnswers.multiTenant)),
      message: 'Use ION API for Multi-Tenant proxy requests?'
   };
   const answers = await inquirer.prompt([portQuestion, mtQuestion, ionQuestion]);
   const port = parseInt(answers.port, 10);
   const multiTenant = Boolean(answers.multiTenant);
   const ionApi = Boolean(answers.ionApi);
   await wrapServe({ port, multiTenant, ionApi });
};

const inquireCommand = async () => {
   const commandQuestion: ListQuestion = {
      name: 'command',
      type: 'list',
      message: 'What do you want to do?',
      choices: [
         {
            name: 'Create new project',
            value: 'new',
         },
         {
            name: 'Start development server',
            value: 'serve',
         },
         {
            name: 'Build project for production',
            value: 'build',
         },
      ]
   };
   const commandAnswers = await inquirer.prompt([commandQuestion]);
   switch (commandAnswers.command) {
      case 'new':
         await inquireNewProject();
         break;
      case 'serve':
         await inquireServeProject();
         break;
      case 'build':
         buildProject();
         break;
      default:
         break;
   }
};

// Deal with unknown commands
// https://github.com/tj/commander.js/commit/503845b758ad51085319c491cf2c9367542ef1f9#diff-1e290ac8433d555bce009b162cb869d0
program.on('command:*', ([command]) => {
   exit(`Unknown command '${command}'`, true);
});

const isWizard = !process.argv.slice(2).length;
if (isWizard) {
   inquireCommand();
} else {
   program.parse(process.argv);
}
