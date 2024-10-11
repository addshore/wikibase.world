import { getJson } from 'serpapi';
import { world } from './../src/world.js';
import { fetchuc, fetchc } from './../src/fetch.js';
import { queues, ee, HEADERS } from './../src/general.js';
import { checkOnlineAndWikibase } from './../src/site.js';
import dotenv from 'dotenv'
dotenv.config()

const serconfig = function(query) {
    return {
        engine: "google",
        api_key: process.env.SERPAPI_KEY,
        q: query,
        // location: "Austin, Texas",
        location: "Berlin,Berlin,Germany",
        // location: "Hino,Tokyo,Japan",
        num: 100,
        nfpr: 1,
    };
}

// Taken from https://github.com/wikimedia/mediawiki-extensions-Wikibase/blob/master/repo/Wikibase.i18n.alias.php
const specialPages = [
    // "AvailableBadges",
    // "DispatchStats",
    // "EntityData",
    // "EntityPage",
    // "GoToLinkedPage",
    // "ItemByTitle",
    // "ItemDisambiguation",
    // "ItemsWithoutSitelinks",
    "ListDatatypes", // 3 good
    "ListProperties", //3 good
    // "MergeItems",
    // "MyLanguageFallbackChain",
    "NewItem", // 1 good
    "NewProperty", // 1 good
    // "RedirectEntity",
    // "SetAliases", // 2 bad
    // "SetDescription", // 2 bad
    // "SetLabel", // 2 bad
    // "SetLabelDescriptionAliases",
    // "SetSiteLink",
];

// TODO do each special page seperately, and then a.so all of them together?

const domainsToIgnore = [
    "wikidata.org",
    "openstreetmap.org",
    "wikimedia.org",
    "mediawiki.org",
    "wikipedia.org",
    "wikinews.org",
    "wikifunctions.org",
    "github.com",
    "githubusercontent.com",
    "nist.gov",
    "withgoogle.com",
    "reddit.com",
    "facebook.com",
    "instagram.com",
    "twitter.com",
    "amazon.com",
    "mozilla.org",
    "learningwikibase.com",
    "translatewiki.net",
    "addshore.com",
    "cisa.gov",
    "tiktok.com",
    "sony.jp",
    "books.jq",
    "quora.com",
    "mail-archive.com",
    "mitre.org",
    "linkedin.com",
    "medium.com",
    "wikimedia.de",
    "readthedocs.io",
    "amazonaws.com",
    "wikibase.cloud", // As we have an API for that :)
];

const searchTerm = function() {
    // creatime sometihng like...
    // ("specialPage[0]" OR specialPage[n]) -site:domainsToIgnore[0] -site:domainsToIgnore[n] etc...
    const pages = specialPages.map(page => `"Special:${page}"`).join(" OR ");
    const sites = domainsToIgnore.map(site => `-site:${site}`).join(" ");
    return `(${pages}) ${sites}`;
}

let domains = [];

const response = await getJson(serconfig(searchTerm()));
// console.log(response);

response.organic_results.forEach(result => {
    const domain = new URL(result.link).hostname;
    domains.push(domain);
});

// make both lists unique
domains = [...new Set(domains)];

const worldWikis = await world.sparql.wikis();
const worldWikiURLs = worldWikis.map(wiki => wiki.site)

// get the first arg to run.js
const scriptFilter = process.argv[2]
if (scriptFilter != undefined) {
    console.log(`🚀 Running with script filter: ${scriptFilter}`)
}

domains.forEach(domain => {
    if (scriptFilter && domain !== scriptFilter) {
        return
    }
    // Check if the wiki is alive, one at a time so as to not overload cloud
    queues.four.add(async () => {
        // Make sure it doesnt already exist, so make sure the domain doesnt appear in any of the strings in worldWikiURLs
        if (worldWikiURLs.some(wikiURL => wikiURL.includes(domain))) {
            return
        }

        const url = "https://" + domain
        const { result: checkResult, text: checkString } = await checkOnlineAndWikibase(url)
        if (!checkResult) {
            console.log(checkString)
            return
        }

        ee.emit('google.wikis.new', { domain: domain, response: checkResult })
    });
});

// Listen for found wikis
ee.on('google.wikis.new', ({ domain, response }) => {
    const url = "https://" + domain
    const name = domain

    // Create the item
    world.queueWork.itemCreate(queues.one, {
        labels: { en: name },
        claims: {
            // Provide a basic set of claims, but let other things be filled in later.. (by the tidy)
            P1 : url,
            P3: "Q10", // wikibase site
            P13: 'Q54', // active
        }
    }, { summary: `Importing https://${domain} from Google search` });
});