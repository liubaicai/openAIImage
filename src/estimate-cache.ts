import type { CostEstimate } from "../shared/pricing";

// One cache per creation dialog; completed and in-flight requests share the same key.
export class EstimateCache {
  private values = new Map<string, CostEstimate>();
  private pending = new Map<string, Promise<CostEstimate>>();
  read(key: string) {
    return this.values.get(key);
  }
  get(
    key: string,
    fetchCost: () => Promise<CostEstimate>,
  ): Promise<CostEstimate> {
    const value = this.values.get(key);
    if (value) return Promise.resolve(value);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const request = fetchCost()
      .then((cost) => {
        this.values.set(key, cost);
        return cost;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
}
