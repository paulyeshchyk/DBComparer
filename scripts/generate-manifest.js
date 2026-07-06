const path = require('path');

const contribution = require('../src/plugins/manifest.builder/contribution/contributionInjector');
const { rootMenus, allSubmenus, commands } = require('../src/plugins/manifest/contribution/diplodoc.contribution');
const constants = require('../src/plugins/manifest/constants');

const packageJsonPath = path.resolve(__dirname, '../package.json');
const configPath = path.resolve(__dirname, '../src/plugins/manifest/config/diplodoc.config.model.ts');

let request = { rootMenus, allSubmenus, commands };

const configData = new contribution.ConfigData('DiplodocConfig', constants.CONFIG_KEY, constants.CONFIG_TITLE);
contribution.contributionInject(packageJsonPath, configPath, request, configData);
