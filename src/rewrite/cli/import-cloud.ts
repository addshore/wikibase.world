import { createWikibaseCloudSource } from '../sources/cloud.js';
import { runImportCli } from './import-source.js';

runImportCli(createWikibaseCloudSource()).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
