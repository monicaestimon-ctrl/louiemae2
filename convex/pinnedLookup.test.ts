import { describe, expect, it, vi } from "vitest";
import { createServer, get } from "node:http";
import { createPinnedLookup } from "./pinnedLookup";

describe("createPinnedLookup", () => {
    const address = { address: "93.184.216.34", family: 4 } as const;

    it("returns an address list when Node requests all addresses", () => {
        const callback = vi.fn();

        createPinnedLookup(address)("example.com", { all: true }, callback);

        expect(callback).toHaveBeenCalledWith(null, [address]);
    });

    it("returns the legacy address and family for a single lookup", () => {
        const callback = vi.fn();

        createPinnedLookup(address)("example.com", { all: false }, callback);

        expect(callback).toHaveBeenCalledWith(null, address.address, address.family);
    });

    it("works through Node's HTTP client without producing an undefined IP", async () => {
        const server = createServer((_request, response) => response.end("ok"));
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });

        try {
            const serverAddress = server.address();
            if (!serverAddress || typeof serverAddress === "string") throw new Error("Test server did not bind to TCP.");

            const body = await new Promise<string>((resolve, reject) => {
                get({
                    hostname: "public.example",
                    port: serverAddress.port,
                    lookup: createPinnedLookup({ address: "127.0.0.1", family: 4 }),
                }, response => {
                    const chunks: Buffer[] = [];
                    response.on("data", chunk => chunks.push(Buffer.from(chunk)));
                    response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
                }).on("error", reject);
            });

            expect(body).toBe("ok");
        } finally {
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
    });
});
