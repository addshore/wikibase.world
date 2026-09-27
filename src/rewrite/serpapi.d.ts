declare module 'serpapi' {
    import type { GoogleSearch, GoogleSearchOptions } from './sources/google.js';

    export const getJson: GoogleSearch;
    export type SearchOptions = GoogleSearchOptions;
}
