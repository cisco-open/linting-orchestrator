// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Custom resolver for Spectral that behaves like the default resolver
 * but does not resolve external dependencies (e.g., URLs pointing to HTTP/HTTPS links).
 * This prevents network timeouts and 504 errors when processing OpenAPI specs
 * that contain external $ref attributes in examples (like SCIM specifications).
 *
 * External references are returned as-is without modification, while internal
 * references (starting with #) are processed normally by the default resolver.
 */

import { Resolver } from '@stoplight/json-ref-resolver';

class CustomResolver extends Resolver {
    constructor() {
        super();
    }

    async resolve(ref, baseUri, options) {
        try {
            // Is it a valid URL?
            const parsedUrl = new URL(ref);

            // If it's an HTTP or HTTPS link, let's simply ignore it
            if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
                if (process.env.DEBUG_SPECTRAL_RESOLVER) {
                    console.log(`[CUSTOM-RESOLVER] Ignoring external $ref: '${parsedUrl.href}'`);
                }
                return ref;
            }

            // If not an http/https $ref, proceed with spectral's standard resolver
            return super.resolve(ref, baseUri, options);

        } catch (e) {
            if (process.env.DEBUG_SPECTRAL_RESOLVER) {
                console.log(`[CUSTOM-RESOLVER] Deferring to default resolver for ref: '${ref}'`);
            }

            // If it's not parsable (likely not a valid URL), pass to spectral's standard resolver
            return super.resolve(ref, baseUri, options);
        }
    }
}

// Register custom resolvers for http & https
export default new Resolver({
    resolvers: {
        http: new CustomResolver(),
        https: new CustomResolver()
    }
});