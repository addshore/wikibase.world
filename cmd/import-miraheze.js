import fetch from 'node-fetch';
import { world } from './../src/world.js';
import { queues, HEADERS } from './../src/general.js';

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
        const html = await response.text();
        return { url: response.url, html: html };
    } catch {
        console.log(`Failed to fetch ${url}`);
        return null;
    }
}

async function getWikiStatus(domain) {
    const url = `https://${domain}.miraheze.org/wiki/Main_Page?uselang=en`; // assumption
    try {
        const response = await fetch(url, { headers: HEADERS });
        const text = await response.text();
        
        // Check if wiki is deleted
        if (text.includes("<title>Wiki deleted</title>") || text.includes("<h1><b>Wiki deleted</b></h1>")) {
            return 'Q57'; // offline permanently
        }
        
        // Check if wiki is closed due to dormancy
        if (text.includes("This wiki has been automatically closed because there have been") ||
            text.includes('Dormancy Policy">closed</a>')) {
            return 'Q1345'; // closed
        }
        
        return 'Q54'; // active
    } catch {
        console.log(`Failed to fetch main page for ${domain}`);
        return 'Q54'; // assume active on error
    }
}

async function main() {
    const dbNames = await fetchMirahezeDbList();

    for (const db of dbNames) {
        const domain = `${db}.miraheze.org`;

        // // Do an initial check to see if the wiki is already in the world (before trying to resolve the URL)
        // if (worldWikiURLs.some(wikiURL => wikiURL.includes(domain))) {
        //     console.log(`Wiki ${domain} already exists in world.`);
        //     continue;
        // }

        const finalUrl = await resolveFinalUrl(db);
        if (!finalUrl) continue;
        const finalDomain = new URL(finalUrl.url).hostname;

        if (worldWikiURLs.some(wikiURL => wikiURL.includes(finalDomain)) || worldWikiURLs.some(wikiURL => wikiURL.includes(domain))) {
            // Find the item ID for the existing wiki
            let existingItemId = undefined;
            for (let i = 0; i < worldWikiURLs.length; i++) {
                if (worldWikiURLs[i].includes(finalDomain) || worldWikiURLs[i].includes(domain)) {
                    existingItemId = worldWikis[i].item;
                    break;
                }
            }
            if (existingItemId) {
                // Get the wiki status and update the activity claim accordingly
                const value = await getWikiStatus(db);
                world.queueWork.claimEnsure(
                    queues.one,
                    { id: existingItemId, property: 'P13', value },
                    { summary: `Set activity [[Property:P13]] for Miraheze wiki to [[Item:${value}]] based on banners` }
                );
                console.log(`Ensured activity claim for existing Miraheze wiki: ${finalDomain} (P13=${value})`);
            }
            continue;
        }

        // If the page doesnt contain "wikibase" or "Wikibase somewhere on it, break (dont blindly trust the list)
        if (!finalUrl.html.includes("wikibase") && !finalUrl.html.includes("Wikibase")) {
            console.log(`Wiki ${domain} does not appear to be a Wikibase wiki.`);
            continue;
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
        const status = await getWikiStatus(db);
        claims.P13 = status; // TODO add a reference?

        world.queueWork.itemCreate(queues.one, {
            labels,
            ...(Object.keys(aliases).length > 0 && { aliases }),
            claims
        }, { summary: `Importing ${finalDomain} from Miraheze list: ` + listUrl });
        console.log(`Queued new Miraheze wiki: ${finalDomain}`);
    }
}

main();
