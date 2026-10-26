import {
  PublicAnswer,
  PublicItemStub,
  PublicManifest,
  PublicQuestion,
  PublicSource,
  SUPPORTED_CONTRACT_VERSION,
  findForbiddenKeys,
} from "@/contract/lrn-public-v1";
import type { ContentOrigin } from "./types";

/**
 * A content pack is a published CUSP LRN bundle laid out as static JSON:
 *   manifest.json · stubs/<domainId>.json · q/<id>.json · a/<id>.json · sources.json
 *
 * Showdown reads packs; it never writes them. The private content repo is not
 * touched: the bundle it publishes to the public web repo is the only input.
 */
export interface ContentPack {
  readonly origin: ContentOrigin;
  readonly baseUrl: string;
  getManifest(): Promise<PublicManifest>;
  listStubs(): Promise<PublicItemStub[]>;
  getQuestion(id: string): Promise<PublicQuestion>;
  /** Call only after a response is locked in. Never prefetch this. */
  getAnswer(id: string): Promise<PublicAnswer>;
  getSources(): Promise<PublicSource[]>;
}

export class ContentError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ContentError";
  }
}

export class ContractVersionError extends ContentError {
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(
      `This content bundle uses public contract version ${found}, and this build of ` +
        `Showdown reads version ${supported}. Update the adapter in ` +
        `src/contract/lrn-public-v1.ts before using it.`,
    );
    this.name = "ContractVersionError";
  }
}

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface StaticPackOptions {
  origin: ContentOrigin;
  baseUrl: string;
  fetcher?: Fetcher;
}

/** Reads a pack from static JSON over HTTP, with request de-duplication. */
export class StaticJsonContentPack implements ContentPack {
  readonly origin: ContentOrigin;
  readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(opts: StaticPackOptions) {
    this.origin = opts.origin;
    this.baseUrl = opts.baseUrl.endsWith("/") ? opts.baseUrl : `${opts.baseUrl}/`;
    this.fetcher = opts.fetcher ?? ((url) => fetch(url));
  }

  private once<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const p = load();
    this.inflight.set(key, p);
    p.catch(() => this.inflight.delete(key));
    return p;
  }

  private async getJson<T>(rel: string, parse: (x: unknown) => T): Promise<T> {
    const url = `${this.baseUrl}${rel}`;
    let res;
    try {
      res = await this.fetcher(url);
    } catch (cause) {
      throw new ContentError(`Could not reach the content bundle at ${url}.`, cause);
    }
    if (!res.ok) throw new ContentError(`Could not load ${rel} from the content bundle (HTTP ${res.status}).`);
    let raw: unknown;
    try {
      raw = await res.json();
    } catch (cause) {
      throw new ContentError(`${rel} in the content bundle is not valid JSON.`, cause);
    }
    // Upstream runs a leak scan at publish time; re-check here so a bundle that
    // smuggles internal fields is refused rather than rendered.
    const leaked = findForbiddenKeys(raw);
    if (leaked.length) {
      throw new ContentError(
        `${rel} contains internal-only field(s) ${leaked.join(", ")} and was refused.`,
      );
    }
    try {
      return parse(raw);
    } catch (cause) {
      throw new ContentError(`${rel} does not match the published content contract.`, cause);
    }
  }

  getManifest(): Promise<PublicManifest> {
    return this.once("manifest", async () => {
      const m = await this.getJson("manifest.json", (x) => PublicManifest.parse(x));
      if (m.contractVersion !== SUPPORTED_CONTRACT_VERSION) {
        throw new ContractVersionError(m.contractVersion, SUPPORTED_CONTRACT_VERSION);
      }
      return m;
    });
  }

  async listStubs(): Promise<PublicItemStub[]> {
    const manifest = await this.getManifest();
    const lists = await Promise.all(
      manifest.stubFiles.map((file) =>
        this.once(file, () => this.getJson(file, (x) => PublicItemStub.array().parse(x))),
      ),
    );
    return lists.flat();
  }

  getQuestion(id: string): Promise<PublicQuestion> {
    return this.once(`q/${id}`, () =>
      this.getJson(`q/${encodeURIComponent(id)}.json`, (x) => PublicQuestion.parse(x)),
    );
  }

  getAnswer(id: string): Promise<PublicAnswer> {
    return this.once(`a/${id}`, () =>
      this.getJson(`a/${encodeURIComponent(id)}.json`, (x) => PublicAnswer.parse(x)),
    );
  }

  getSources(): Promise<PublicSource[]> {
    return this.once("sources", () =>
      this.getJson("sources.json", (x) => PublicSource.array().parse(x)),
    );
  }
}
