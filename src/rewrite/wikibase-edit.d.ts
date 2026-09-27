declare module 'wikibase-edit' {
    interface WikibaseEditConfig {
        instance: string;
        credentials: {
            username: string;
            password: string;
        };
        bot?: boolean;
        maxlag?: number;
    }

    interface EntityCreateResponse {
        entity?: {
            id?: string;
        };
    }

    interface WikibaseEditClient {
        entity: {
            create(
                data: Record<string, unknown>,
                requestConfig?: { summary?: string },
            ): Promise<EntityCreateResponse>;
        };
        claim: {
            create(
                data: {
                    id: string;
                    property: string;
                    value: string | number | Record<string, unknown>;
                    qualifiers?: Record<string, unknown>;
                    references?: Record<string, unknown>;
                },
                requestConfig?: { summary?: string },
            ): Promise<unknown>;
            update(
                data: { guid: string; newValue: string | number | Record<string, unknown> },
                requestConfig?: { summary?: string },
            ): Promise<unknown>;
            remove(
                data: { guid: string },
                requestConfig?: { summary?: string },
            ): Promise<unknown>;
        };
        reference: {
            set(
                data: { guid: string; snaks: Record<string, unknown> },
                requestConfig?: { summary?: string },
            ): Promise<unknown>;
        };
        description: {
            set(
                data: { id: string; language: string; value: string },
                requestConfig?: { summary?: string },
            ): Promise<unknown>;
        };
        alias: {
            remove(
                data: { id: string; language: string; value: string },
                requestConfig?: { summary?: string },
            ): Promise<unknown>;
        };
    }

    export default function WBEdit(config: WikibaseEditConfig): WikibaseEditClient;
}
