import fetch from 'node-fetch';
import { world } from './../src/world.js';
import { queues, ee, HEADERS } from './../src/general.js';

// Miraheze host QID
const MIRAHEZE_QID = 'Q118';
// TODO allow this to be passed in?
const listUrl = 'https://www.irccloud.com/pastebin/raw/cOYehYeA/wr.php';

const worldWikis = await world.sparql.wikisAll();
const worldWikiURLs = worldWikis.map(wiki => wiki.site)

async function fetchMirahezeDbList() {
    const response = await fetch(listUrl);
    const text = await response.text();
    // Match lines like 'aftertheendwiki' =>
    const matches = [...text.matchAll(/'([a-z0-9]+)wiki'\s*=>/g)];
    return matches.map(m => m[1]);
}

async function resolveFinalUrl(domain) {
    const url = `https://${domain}.miraheze.org`;
    try {
        const response = await fetch(url, { headers: HEADERS, redirect: 'follow' });
        return response.url;
    } catch (e) {
        console.log(`Failed to fetch ${url}`);
        return null;
    }
}

async function isWikiClosed(domain) {
    const url = `https://${domain}.miraheze.org/wiki/Main_Page`; // assumption
    try {
        const response = await fetch(url, { headers: HEADERS });
        const text = await response.text();
        return text.includes("This wiki has been automatically closed because there have been");
    } catch (e) {
        console.log(`Failed to fetch main page for ${domain}`);
        return false;
    }
}

async function main() {
    const dbNames = await fetchMirahezeDbList();
    const worldWikis = await world.sparql.wikisAll();

    for (const db of dbNames) {
        const domain = `${db}.miraheze.org`;
        const finalUrl = await resolveFinalUrl(db);
        if (!finalUrl) continue;
        const normalizedUrl = finalUrl.replace(/\/$/, '');
        const finalDomain = new URL(finalUrl).hostname;

        if (worldWikiURLs.some(wikiURL => wikiURL.includes(finalDomain)) || worldWikiURLs.some(wikiURL => wikiURL.includes(domain))) {
            console.log(`Wiki ${finalDomain} already exists in world.`);
            continue;
        } else {
            // TODO do some basic things if it is already found? like update status like to cloud..
        }

        let labels = {};
        let aliases = {};

        if (finalDomain !== domain) {
            labels.en = finalDomain;
            aliases.en = [domain];
        } else {
            labels.en = domain;
        }

        // Check if the wiki is closed
        let claims = {
            P1: "https://" + finalDomain,
            P2: MIRAHEZE_QID,
            P3: "Q10", // wikibase site
        };
        if (await isWikiClosed(db)) {
            claims.P13 = "Q1345"; // TODO add a reference?
        }

        world.queueWork.itemCreate(queues.one, {
            labels,
            ...(Object.keys(aliases).length > 0 && { aliases }),
            claims
        }, { summary: `Importing ${finalDomain} from Miraheze list: ` + listUrl });
        console.log(`Queued new Miraheze wiki: ${finalDomain}`);
    }
}

main();
