import { fetchuc, fetchc } from './../src/fetch.js';
import { HEADERS } from './../src/general.js';

const checkOnlineAndWikibase = async (url) => {
    try{
        const response = await fetchc(url, { headers: HEADERS })
        const responseText = await response.text();
        response.loadedText = responseText
        if (!(response.status == 200 || ( response.status === 404 && responseText.includes("There is currently no text in this page") ) ) ) {
            return {result: false, text: `❌ The URL ${url} is not currently a 200 or a 404 with the expected MediaWiki text`}
        }

        // Bail if it doesnt have a correct EditURI
        let actionApiMatchs = responseText.match(/<link rel="EditURI" type="application\/rsd\+xml" href="(.+?)"/)
        if (!actionApiMatchs) {
            return {result: false, text: `❌ The URL ${url} does not have a correct EditURI for MediaWiki`}
        }

        // Then we need to make sure it has Wikibase?
        // use the api.php match, but get index.php?title=Special:Version instead
        let x = actionApiMatchs[1].replace('?action=rsd', '');
        // if the url starts with //, make it https://
        if (x.startsWith('//')) {
            x = 'https:' + x
        }
        const versionUrl = x.replace('api.php', 'index.php?title=Special:Version')
        const responseVersion = await fetchc(versionUrl, { headers: HEADERS })
        // check for mw-version-ext-wikibase-WikibaseRepository
        const responseVersionText = await responseVersion.text();
        if (!responseVersionText.includes("mw-version-ext-wikibase-WikibaseRepository")) {
            return {result: false, text: `❌ The URL ${url} does not have Wikibase Repo installed`}
        }

        return {result: response, text: url}
    } catch (e) {
        return {result: false, text: `❌ The URL ${url} check failed` + e}
    }
}

export { checkOnlineAndWikibase };