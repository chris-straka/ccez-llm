import { describe, expect, it } from "vitest";
import { createSleepClaim } from "./sleep-claim";

function bridge() {
	const resolvers: ((id: number | null) => void)[] = [];
	const live = new Set<number>();
	let next = 1;
	const block = () =>
		new Promise<number | null>((resolve) => {
			const id = next++;
			resolvers.push(() => {
				live.add(id);
				resolve(id);
			});
		});
	const unblock = (id: number) => live.delete(id);
	const settle = async () => {
		while (resolvers.length) resolvers.shift()!(null);
		await Promise.resolve();
		await Promise.resolve();
	};
	return { block, unblock, live, settle, requests: () => next - 1 };
}

describe("createSleepClaim", () => {
	it("holds one claim however often it is told to", async () => {
		const b = bridge();
		const set = createSleepClaim(b.block, b.unblock);
		set(true);
		set(true);
		await b.settle();
		set(true);
		expect(b.requests()).toBe(1);
		expect(b.live.size).toBe(1);
		set(false);
		expect(b.live.size).toBe(0);
	});

	it("releases a claim that lands after the need passed", async () => {
		const b = bridge();
		const set = createSleepClaim(b.block, b.unblock);
		set(true);
		set(false);
		await b.settle();
		expect(b.live.size).toBe(0);
	});

	it("keeps the late claim when the need came back meanwhile", async () => {
		const b = bridge();
		const set = createSleepClaim(b.block, b.unblock);
		set(true);
		set(false);
		set(true);
		await b.settle();
		expect(b.requests()).toBe(1);
		expect(b.live.size).toBe(1);
		set(false);
		expect(b.live.size).toBe(0);
	});
});
