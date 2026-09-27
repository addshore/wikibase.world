import { readFile } from 'node:fs/promises';
import { createUrlListSource } from '../sources/url-list.js';
import { runImportCli } from './import-source.js';

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const inputFiles = args
        .filter(argument => argument.startsWith('--file='))
        .map(argument => argument.slice('--file='.length));
    if (inputFiles.length > 1) throw new Error('Pass at most one --file option');

    const hostItem = args.find(argument => argument.startsWith('--host='))?.slice('--host='.length);
    if (hostItem && !/^Q\d+$/.test(hostItem)) throw new Error('--host must be an item ID such as Q8');

    const acceptedFlags = args.filter(argument =>
        argument === '--write' ||
        argument.startsWith('--filter=') ||
        argument.startsWith('--limit='),
    );
    const unknownOptions = args.filter(argument =>
        argument.startsWith('--') &&
        !argument.startsWith('--file=') &&
        !argument.startsWith('--host=') &&
        !acceptedFlags.includes(argument),
    );
    if (unknownOptions.length) throw new Error(`Unknown arguments: ${unknownOptions.join(', ')}`);

    const directUrls = args.filter(argument => !argument.startsWith('--'));
    const fileUrls = inputFiles.length
        ? (await readFile(inputFiles[0], 'utf8')).split(/\r?\n/).map(line => line.trim()).filter(Boolean)
        : [];
    const urls = [...fileUrls, ...directUrls];
    if (urls.length === 0) {
        throw new Error('Provide one or more site URLs, or use --file=path');
    }

    await runImportCli(createUrlListSource(urls, { hostItem }), acceptedFlags);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
