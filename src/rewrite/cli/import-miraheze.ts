import { createMirahezeSource } from '../sources/miraheze.js';
import { runImportCli } from './import-source.js';

runImportCli(createMirahezeSource()).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
