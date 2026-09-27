export type ClaimValue = string | number | Record<string, unknown>;

export interface WikiCandidate {
    source: string;
    site: string;
    label?: string;
    aliases?: string[];
    claims?: Record<string, ClaimValue>;
    syncClaims?: Record<string, ClaimValue>;
}

export interface WikiDiscoverySource {
    discover(): Promise<WikiCandidate[]>;
    syncMissing?(knownWikis: KnownWiki[], discovered: WikiCandidate[]): ClaimSync[];
}

export interface KnownWiki {
    item: string;
    site: string;
    hostItem?: string;
    statusItem?: string;
}

export interface ClaimSync {
    item: string;
    site: string;
    source: string;
    property: string;
    value: ClaimValue;
    policy: 'single' | 'include';
}

export interface VerifiedWiki {
    site: string;
}

export interface WikiVerifier {
    verify(site: string): Promise<VerifiedWiki | null>;
}

export interface WikiWriter {
    create(candidate: WikiCandidate): Promise<string>;
}

export interface ClaimWriter {
    ensureClaim(input: {
        id: string;
        property: string;
        value: ClaimValue;
        policy: 'single' | 'include';
        numericThreshold?: number;
        qualifiers?: Record<string, ClaimValue>;
        references?: Record<string, ClaimValue>;
        referenceOnly?: boolean;
        summary: string;
    }): Promise<void>;
}

export interface EntityMetadataWriter {
    setDescription(input: {
        id: string;
        language: string;
        value: string;
        summary: string;
    }): Promise<void>;
    removeAlias(input: {
        id: string;
        language: string;
        value: string;
        summary: string;
    }): Promise<void>;
}

export type DiscoveryStatus = 'existing' | 'duplicate' | 'invalid' | 'planned' | 'created';

export interface DiscoveryResult {
    candidate: WikiCandidate;
    site: string;
    status: DiscoveryStatus;
    item?: string;
}
