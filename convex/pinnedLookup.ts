import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";

/**
 * Keep outbound requests pinned to the public DNS result validated by the
 * scraper while supporting both Node lookup callback modes. Node's HTTP
 * client requests `all: true` when automatic address-family selection is on.
 */
export const createPinnedLookup = (address: LookupAddress): LookupFunction =>
    (_hostname, options, callback) => {
        if (options.all) {
            callback(null, [address]);
            return;
        }

        callback(null, address.address, address.family);
    };
