export function canonicalSiteKey(site: string): string {
    const url = new URL(site);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
        throw new TypeError('Site URL must use HTTP or HTTPS and include a hostname');
    }
    const hostname = url.hostname.toLowerCase();
    const port = url.port && !(
        (url.protocol === 'http:' && url.port === '80') ||
        (url.protocol === 'https:' && url.port === '443')
    ) ? `:${url.port}` : '';
    const path = url.pathname.replace(/\/+$/, '');

    return `${hostname}${port}${path}`;
}
