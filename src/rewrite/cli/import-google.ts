import { getJson } from 'serpapi';
import { createGoogleSearchSource } from '../sources/google.js';
import { runImportCli } from './import-source.js';

runImportCli(createGoogleSearchSource({
    apiKey: process.env.SERPAPI_KEY,
    search: getJson,
})).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
