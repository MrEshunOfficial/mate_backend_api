// services/tasks/task.matching.service.ts
import { Types, HydratedDocument } from "mongoose";
import {
  Task,
  TaskMethods,
  TaskStatus,
  ProviderMatchResult,
  TaskMatchingConfig,
  MatchingSummary,
} from "../../types/tasks.types";
import { Coordinates } from "../../types/location.types";
import {
  LocationService,
  locationService as defaultLocationService,
} from "../location.service";
import ProviderProfileModel from "../../models/profiles/provider.profile.model";
import TaskModel from "../../models/task.model";

type TaskDocument = HydratedDocument<Task, TaskMethods>;

// ─── Text Utility Constants ───────────────────────────────────────────────────

/**
 * Common English stop words removed before text similarity scoring.
 * Keeping the set small and focused on the most common noise words keeps
 * the tokeniser fast without over-filtering domain vocabulary.
 */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "i", "you", "he", "she", "it",
  "we", "they", "my", "your", "his", "her", "its", "our", "their", "this",
  "that", "these", "those", "what", "which", "who", "whom", "need", "want",
  "get", "make", "use", "from", "into", "than", "then", "so", "if",
  "about", "also", "some", "any", "all",
]);

// ─── Score Breakdown shape (internal) ────────────────────────────────────────

interface ScoreBreakdown {
  titleScore: number;
  descriptionScore: number;
  tagScore: number;
  categoryScore: number;
  locationScore: number;
  pricingScore: number;
}

// ─── Internal provider evaluation result ─────────────────────────────────────

interface ServiceEvalResult {
  matchedServices: Types.ObjectId[];
  titleScore: number;
  descriptionScore: number;
  tagScore: number;
  categoryScore: number;
  pricingScore: number;
}

// ─── TaskMatchingService ──────────────────────────────────────────────────────

export class TaskMatchingService {

  // ─── Default Config ─────────────────────────────────────────────────────────

  /**
   * Default matching configuration.
   *
   * Weights must sum to 1.0.
   * - Category and title are highest because they are the most reliable signals.
   * - Location is intentionally weighted lower than content signals to avoid
   *   penalising excellent providers who are 15–20 km away.
   * - Pricing is lowest — budget is often approximate or absent.
   */
  static readonly DEFAULT_CONFIG: TaskMatchingConfig = {
    maxDistanceKm:        50,
    prioritizeNearby:     true,
    weights: {
      titleMatch:        0.25,
      descriptionMatch:  0.15,
      tagMatch:          0.20,
      categoryMatch:     0.20,
      locationProximity: 0.15,
      pricingMatch:      0.05,
    },
    minimumMatchScore:    25,
    maxProvidersToReturn: 10,
    fallbackToLocationOnly: true,
    fallbackThreshold:    3,
  };

  constructor(
    private readonly config: TaskMatchingConfig = TaskMatchingService.DEFAULT_CONFIG,
    private readonly locationService: LocationService = defaultLocationService,
  ) {}

  // ─── Model Binding ───────────────────────────────────────────────────────────

  /**
   * Binds the scoring methods to the TaskModel prototype, replacing the stub
   * implementations that throw at runtime.
   *
   * Must be called once at application startup BEFORE any task matching is
   * attempted. Typical placement:
   *
   *   // app.ts / server.ts (bootstrap)
   *   import { taskMatchingService } from './services/tasks/task.matching.service';
   *   taskMatchingService.bindToModel();
   *
   * The binding assigns closures that delegate to this service instance,
   * keeping the model file free of business logic while allowing route handlers
   * to call task.findMatches() without importing the service directly.
   */
  bindToModel(): void {
    const self = this;

    (TaskModel as any).prototype.findMatches = async function (
      this: TaskDocument,
      strategy: "intelligent" | "location-only" = "intelligent",
    ): Promise<TaskDocument> {
      const { task } = await self.runMatching(this, strategy);
      return task;
    };

    (TaskModel as any).prototype.calculateIntelligentMatchScore = function (
      this: TaskDocument,
      provider: any,
      services: any[],
    ): ProviderMatchResult {
      return self.calculateIntelligentMatchScore(this, provider, services);
    };

    (TaskModel as any).prototype.calculateLocationMatchScore = function (
      this: TaskDocument,
      provider: any,
    ): ProviderMatchResult {
      return self.calculateLocationMatchScore(this, provider);
    };

    (TaskModel as any).prototype.buildMatchReasons = function (
      this: TaskDocument,
      provider: any,
      services: any[],
      scores: ScoreBreakdown,
    ): string[] {
      return self.buildMatchReasons(this, provider, services, scores);
    };
  }

  // ─── Core Matching Pipeline ──────────────────────────────────────────────────

  /**
   * Orchestrates the full provider matching cycle for a task document.
   *
   * Flow:
   *   1. Fetch provider candidates scoped to the task's region
   *   2. Score each candidate using the chosen strategy
   *   3. If intelligent matching yields fewer than fallbackThreshold results,
   *      fall back to location-only and use whichever set is larger
   *   4. Persist matchedProviders, matchingAttemptedAt, matchingCriteria,
   *      and the updated status (MATCHED or FLOATING) on the document
   *   5. Return the saved document and a human-readable MatchingSummary
   *
   * This method is called by:
   *   - TaskService.createTask()        — immediately after task creation
   *   - TaskService.updateTask()        — when content changes warrant re-matching
   *   - TaskService.triggerMatching()   — manual re-trigger by admin / client
   *   - task.findMatches() (via binding) — called directly on the document
   */
  async runMatching(
    task: TaskDocument,
    strategy: "intelligent" | "location-only" = "intelligent",
  ): Promise<{ task: TaskDocument; summary: MatchingSummary }> {
    const candidates = await this.fetchProviderCandidates(task);

    let results: ProviderMatchResult[] = [];
    let usedStrategy = strategy;

    if (strategy === "intelligent") {
      results = this.runIntelligentMatching(task, candidates);

      // Fall back to location-only if intelligent matching is too sparse
      const threshold = this.config.fallbackThreshold ?? 3;
      if (this.config.fallbackToLocationOnly && results.length < threshold) {
        const locationResults = this.runLocationOnlyMatching(task, candidates);
        if (locationResults.length > results.length) {
          results      = locationResults;
          usedStrategy = "location-only";
        }
      }
    } else {
      results      = this.runLocationOnlyMatching(task, candidates);
      usedStrategy = "location-only";
    }

    // Determine which location source was used for this matching run
    const hasGPS        = !!task.locationContext?.gpsLocationAtPosting;
    const hasRegistered = !!task.locationContext?.registeredLocation?.gpsCoordinates;
    const locationSourceUsed: "registered" | "gps" | "both" =
      hasGPS && hasRegistered ? "both" : hasGPS ? "gps" : "registered";

    const searchTerms = this.extractSearchTerms(task);

    // Persist results on the document
    task.matchedProviders    = results;
    task.matchingAttemptedAt = new Date();
    task.status              = results.length > 0 ? TaskStatus.MATCHED : TaskStatus.FLOATING;
    task.matchingCriteria    = {
      useLocationOnly:    usedStrategy === "location-only",
      searchTerms,
      categoryMatch:      !!task.category,
      budgetRange:        task.estimatedBudget,
      radiusUsedKm:       this.config.maxDistanceKm,
      locationSourceUsed,
    };

    await task.save();

    const totalMatches = results.length;
    const averageMatchScore =
      totalMatches > 0
        ? parseFloat(
            (results.reduce((sum, r) => sum + r.matchScore, 0) / totalMatches).toFixed(2),
          )
        : 0;

    const summary: MatchingSummary = {
      strategy:          usedStrategy as "intelligent" | "location-only",
      totalMatches,
      averageMatchScore,
      searchTermsUsed:   searchTerms,
      radiusUsedKm:      this.config.maxDistanceKm,
      locationSourceUsed,
    };

    return { task, summary };
  }

  // ─── Strategy Runners ────────────────────────────────────────────────────────

  private runIntelligentMatching(
    task: TaskDocument,
    candidates: Array<{ provider: any; services: any[] }>,
  ): ProviderMatchResult[] {
    const results: ProviderMatchResult[] = [];

    for (const { provider, services } of candidates) {
      // Skip providers with no active services — they cannot fulfil any task
      if (!services.length) continue;

      const result = this.calculateIntelligentMatchScore(task, provider, services);

      if (result.matchScore >= this.config.minimumMatchScore) {
        results.push(result);
      }
    }

    return results
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, this.config.maxProvidersToReturn);
  }

  private runLocationOnlyMatching(
    task: TaskDocument,
    candidates: Array<{ provider: any; services: any[] }>,
  ): ProviderMatchResult[] {
    const results: ProviderMatchResult[] = [];

    for (const { provider } of candidates) {
      const result = this.calculateLocationMatchScore(task, provider);
      if (result.matchScore > 0) {
        results.push(result);
      }
    }

    return results
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, this.config.maxProvidersToReturn);
  }

  // ─── Public Scoring Methods (bound to model prototype) ───────────────────────

  /**
   * Full intelligent scoring for one provider against a task.
   *
   * The composite score is:
   *   score = Σ(weight_i × component_i) × 100
   *
   * where each component is a 0–1 normalised signal:
   *   titleScore        — overlap coefficient between task title and service titles
   *   descriptionScore  — overlap between task description and service descriptions
   *   tagScore          — normalised tag intersection
   *   categoryScore     — 1.0 if any service matches the task category, else 0
   *   locationScore     — exponential decay from GPS distance (or region fallback)
   *   pricingScore      — budget–price range overlap
   *
   * The best-scoring service per provider drives the evaluation — not the average.
   * matchedServices lists services that individually passed a low relevance threshold.
   */
  calculateIntelligentMatchScore(
    task: Task,
    provider: any,
    services: any[],
  ): ProviderMatchResult {
    const taskCoords     = this.getTaskCoordinates(task);
    const providerCoords: Coordinates | null =
      provider.locationData?.gpsCoordinates ?? null;

    const distanceKm =
      taskCoords && providerCoords
        ? this.locationService.calculateDistance(taskCoords, providerCoords)
        : Infinity;

    const locationScore =
      distanceKm === Infinity
        ? this.computeRegionFallbackScore(task, provider)
        : this.computeDistanceScore(distanceKm, this.config.maxDistanceKm);

    const serviceEval = this.evaluateProviderServices(task, services);

    const w   = this.config.weights;
    const raw =
      w.titleMatch        * serviceEval.titleScore +
      w.descriptionMatch  * serviceEval.descriptionScore +
      w.tagMatch          * serviceEval.tagScore +
      w.categoryMatch     * serviceEval.categoryScore +
      w.locationProximity * locationScore +
      w.pricingMatch      * serviceEval.pricingScore;

    const matchScore = parseFloat((raw * 100).toFixed(2));

    const scores: ScoreBreakdown = {
      titleScore:       serviceEval.titleScore,
      descriptionScore: serviceEval.descriptionScore,
      tagScore:         serviceEval.tagScore,
      categoryScore:    serviceEval.categoryScore,
      locationScore,
      pricingScore:     serviceEval.pricingScore,
    };

    return {
      providerId:      provider._id,
      matchScore,
      matchedServices: serviceEval.matchedServices,
      matchReasons:    this.buildMatchReasons(task, provider, services, scores),
      distance:        distanceKm === Infinity ? undefined : distanceKm,
      scoreBreakdown: {
        titleScore:       parseFloat((serviceEval.titleScore  * 100).toFixed(2)),
        descriptionScore: parseFloat((serviceEval.descriptionScore * 100).toFixed(2)),
        tagScore:         parseFloat((serviceEval.tagScore     * 100).toFixed(2)),
        categoryScore:    parseFloat((serviceEval.categoryScore * 100).toFixed(2)),
        locationScore:    parseFloat((locationScore            * 100).toFixed(2)),
        pricingScore:     parseFloat((serviceEval.pricingScore * 100).toFixed(2)),
      },
    };
  }

  /**
   * Location-only scoring — used as a fallback when intelligent matching
   * yields too few results.
   *
   * Score is derived purely from proximity (or region match as a fallback
   * when GPS coordinates are unavailable). All matchedServices are included
   * since there is no content-based filter.
   */
  calculateLocationMatchScore(task: Task, provider: any): ProviderMatchResult {
    const taskCoords     = this.getTaskCoordinates(task);
    const providerCoords: Coordinates | null =
      provider.locationData?.gpsCoordinates ?? null;

    let matchScore: number;
    let distanceKm: number | undefined;

    if (taskCoords && providerCoords) {
      const km   = this.locationService.calculateDistance(taskCoords, providerCoords);
      distanceKm = km;
      matchScore = parseFloat(
        (this.computeDistanceScore(km, this.config.maxDistanceKm) * 100).toFixed(2),
      );
    } else {
      const regionScore = this.computeRegionFallbackScore(task, provider);
      matchScore        = parseFloat((regionScore * 100).toFixed(2));
    }

    const reasons: string[] = [];
    if (distanceKm !== undefined && distanceKm < Infinity) {
      reasons.push(`Provider is ${distanceKm.toFixed(1)} km from the task location`);
    } else if (matchScore > 0) {
      const sameCity =
        task.locationContext?.registeredLocation?.city?.toLowerCase() ===
        provider.locationData?.city?.toLowerCase();
      reasons.push(
        sameCity
          ? "Provider operates in the same city"
          : "Provider operates in the same region",
      );
    }

    // Include all provider services when matching on location only
    const allServices: Types.ObjectId[] = (provider.serviceOfferings ?? []).map(
      (s: any) => (typeof s === "object" && s._id ? s._id : s),
    );

    return {
      providerId:      provider._id,
      matchScore,
      matchedServices: allServices,
      matchReasons:    reasons.length ? reasons : ["Provider is available in your area"],
      distance:        distanceKm,
      scoreBreakdown: {
        titleScore:       0,
        descriptionScore: 0,
        tagScore:         0,
        categoryScore:    0,
        locationScore:    matchScore / 100,
        pricingScore:     0,
      },
    };
  }

  /**
   * Assembles human-readable match reasons from normalised score components.
   * Thresholds are intentionally permissive — we want at least one reason per match.
   */
  buildMatchReasons(
    task: Task,
    provider: any,
    services: any[],
    scores: ScoreBreakdown,
  ): string[] {
    const reasons: string[] = [];

    if (scores.categoryScore >= 0.8) {
      reasons.push("Offers services in the requested category");
    }
    if (scores.titleScore >= 0.25) {
      reasons.push("Service titles align with your task");
    }
    if (scores.tagScore >= 0.25) {
      reasons.push("Service tags match your task requirements");
    }
    if (scores.descriptionScore >= 0.15) {
      reasons.push("Service descriptions match your task details");
    }
    if (scores.locationScore >= 0.75) {
      reasons.push("Provider is very close to your location");
    } else if (scores.locationScore >= 0.40) {
      reasons.push("Provider is within a reasonable distance");
    }
    if (scores.pricingScore >= 0.9) {
      reasons.push("Provider pricing fits your stated budget");
    } else if (scores.pricingScore >= 0.5) {
      reasons.push("Provider pricing is near your budget range");
    }

    return reasons.length > 0 ? reasons : ["Provider is available in your area"];
  }

  // ─── Candidate Fetching ──────────────────────────────────────────────────────

  /**
   * Fetches and prepares provider candidates for scoring.
   *
   * Primary filter: same region as the task — dramatically reduces the
   * candidate set without eliminating relevant nearby providers.
   *
   * Fallback: if fewer than MIN_CANDIDATES are found in the region we
   * relax to a national search. This ensures rural tasks still get matches.
   *
   * Only active services (isActive: true, isDeleted: false) are retained
   * per provider — inactive or deleted services are invisible to matching.
   */
  private async fetchProviderCandidates(
    task: TaskDocument,
  ): Promise<Array<{ provider: any; services: any[] }>> {
    const region = task.locationContext?.registeredLocation?.region;

    const baseQuery: Record<string, any> = { isDeleted: false };
    if (region) baseQuery["locationData.region"] = region;

    let providers = await ProviderProfileModel.find(baseQuery)
      .populate({
        path:   "serviceOfferings",
        match:  { isActive: true, isDeleted: false },
        select: "title description tags categoryId servicePricing isActive",
      })
      .lean();

    // National fallback when the region is too sparse
    const MIN_CANDIDATES = 5;
    if (providers.length < MIN_CANDIDATES && region) {
      providers = await ProviderProfileModel.find({ isDeleted: false })
        .populate({
          path:   "serviceOfferings",
          match:  { isActive: true, isDeleted: false },
          select: "title description tags categoryId servicePricing isActive",
        })
        .lean();
    }

    return providers.map((provider) => ({
      provider,
      services: (provider.serviceOfferings ?? []).filter(
        (s: any) => s && typeof s === "object" && s._id,
      ),
    }));
  }

  // ─── Per-Provider Service Evaluation ─────────────────────────────────────────

  /**
   * Scores all of a provider's active services against the task, retaining
   * the best (maximum) score per signal across all services.
   *
   * This means a provider who offers 10 services is rewarded if ANY one of
   * them closely matches the task — we never average across services.
   *
   * A service is added to matchedServices when it individually passes a low
   * relevance bar (score ≥ 0.10) or matches on category or title alone.
   */
  private evaluateProviderServices(
    task: Task,
    services: any[],
  ): ServiceEvalResult {
    const taskTitleTokens = this.tokenize(task.title);
    const taskDescTokens  = this.tokenize(task.description);
    const taskTags        = (task.tags ?? []).map((t) => t.toLowerCase().trim());
    const taskCategoryId  = task.category?.toString() ?? null;

    let maxTitle    = 0;
    let maxDesc     = 0;
    let maxTag      = 0;
    let maxCategory = 0;
    let maxPricing  = 0;

    const matchedServices: Types.ObjectId[] = [];

    for (const service of services) {
      const svcTitleTokens = this.tokenize(service.title ?? "");
      const svcDescTokens  = this.tokenize(service.description ?? "");
      const svcTags        = (service.tags ?? []).map((t: string) => t.toLowerCase().trim());
      const svcCategoryId  = service.categoryId?.toString() ?? null;

      const titleScore    = this.computeTokenOverlap(taskTitleTokens, svcTitleTokens);
      const descScore     = this.computeTokenOverlap(taskDescTokens, svcDescTokens);
      const tagScore      = this.computeTagOverlap(taskTags, svcTags);
      const categoryScore =
        taskCategoryId && svcCategoryId && taskCategoryId === svcCategoryId ? 1 : 0;
      const pricingScore  = this.computePricingScore(task, service);

      // A service qualifies as "matched" when it passes any meaningful signal
      const serviceIsMatch =
        categoryScore === 1 ||
        titleScore >= 0.15 ||
        tagScore   >= 0.20 ||
        (titleScore + descScore + tagScore) / 3 >= 0.10;

      if (serviceIsMatch) {
        matchedServices.push(service._id as Types.ObjectId);
      }

      maxTitle    = Math.max(maxTitle,    titleScore);
      maxDesc     = Math.max(maxDesc,     descScore);
      maxTag      = Math.max(maxTag,      tagScore);
      maxCategory = Math.max(maxCategory, categoryScore);
      maxPricing  = Math.max(maxPricing,  pricingScore);
    }

    return {
      matchedServices,
      titleScore:       maxTitle,
      descriptionScore: maxDesc,
      tagScore:         maxTag,
      categoryScore:    maxCategory,
      pricingScore:     maxPricing,
    };
  }

  // ─── Scoring Primitives ──────────────────────────────────────────────────────

  /**
   * Tokenises text into a deduplicated array of normalised, meaningful words.
   *
   * Process:
   *   1. Lowercase
   *   2. Replace non-alphanumeric characters with spaces
   *   3. Split on whitespace
   *   4. Discard tokens shorter than 3 characters
   *   5. Remove stop words
   *   6. Deduplicate (Set → array)
   */
  private tokenize(text: string): string[] {
    if (!text?.trim()) return [];
    return [
      ...new Set(
        text
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
      ),
    ];
  }

  /**
   * Overlap coefficient between two token arrays.
   *
   * overlap(A, B) = |A ∩ B| / min(|A|, |B|)
   *
   * Preferred over Jaccard for asymmetric sets (a short task title vs a long
   * service description) because it does not penalise the larger set for
   * containing additional vocabulary.
   *
   * Returns 0 when either set is empty.
   */
  private computeTokenOverlap(a: string[], b: string[]): number {
    if (!a.length || !b.length) return 0;
    const setA        = new Set(a);
    const setB        = new Set(b);
    const intersection = [...setA].filter((x) => setB.has(x)).length;
    return intersection / Math.min(setA.size, setB.size);
  }

  /**
   * Normalised tag intersection — overlap coefficient applied to tag arrays.
   */
  private computeTagOverlap(taskTags: string[], serviceTags: string[]): number {
    if (!taskTags.length || !serviceTags.length) return 0;
    const setA        = new Set(taskTags);
    const setB        = new Set(serviceTags);
    const intersection = [...setA].filter((t) => setB.has(t)).length;
    return intersection / Math.min(setA.size, setB.size);
  }

  /**
   * Converts a Haversine distance to a 0–1 proximity score using an
   * exponential decay curve.
   *
   * Properties:
   *   distance = 0         → score = 1.0
   *   distance = maxKm / 3 → score ≈ 0.6  (good local match)
   *   distance = maxKm     → score ≈ 0.05 (edge of range)
   *   distance > maxKm     → score = 0.0
   *
   * λ is chosen so that score(maxKm) = 0.05, providing a smooth curve
   * that rewards truly local providers without hard-capping results.
   */
  private computeDistanceScore(distanceKm: number, maxKm: number): number {
    if (distanceKm <= 0)   return 1;
    if (distanceKm > maxKm) return 0;
    const lambda = Math.log(1 / 0.05) / maxKm;
    return parseFloat(Math.max(0, Math.exp(-lambda * distanceKm)).toFixed(4));
  }

  /**
   * Region/city text match used when GPS coordinates are unavailable for
   * either the task or the provider.
   *
   * Returns:
   *   0.0  — different regions (not a relevant local provider)
   *   0.40 — same region, different city
   *   0.70 — same region and same city
   */
  private computeRegionFallbackScore(task: Task, provider: any): number {
    const taskRegion = task.locationContext?.registeredLocation?.region?.toLowerCase()?.trim();
    const taskCity   = task.locationContext?.registeredLocation?.city?.toLowerCase()?.trim();
    const pRegion    = provider.locationData?.region?.toLowerCase()?.trim();
    const pCity      = provider.locationData?.city?.toLowerCase()?.trim();

    if (!taskRegion || !pRegion || taskRegion !== pRegion) return 0;

    if (taskCity && pCity && taskCity === pCity) return 0.70;
    return 0.40;
  }

  /**
   * Computes how closely the service's base price fits the task's stated budget.
   *
   * Decision table:
   *   No budget stated             → 0.50 (neutral — don't penalise or reward)
   *   Negotiable / no price set    → 0.50 (cannot compare)
   *   Free service                 → 1.00 (always fits any budget)
   *   Price within budget range    → 1.00
   *   Price within 20% over range  → 0.50 (slightly over — may negotiate)
   *   Price beyond 20% overshoot   → 0.10 (likely out of range)
   *   Price below min (under-bid)  → 0.70 (under budget is usually acceptable)
   */
  private computePricingScore(task: Task, service: any): number {
    const budget  = task.estimatedBudget;
    const pricing = service.servicePricing;

    if (!budget)                                 return 0.5;
    if (!pricing)                                return 0.5;
    if (pricing.pricingModel === "negotiable")   return 0.5;
    if (pricing.pricingModel === "free")         return 1.0;

    const servicePrice = pricing.basePrice;
    if (servicePrice == null)                    return 0.5;

    const { min, max } = budget;
    const currency     = budget.currency?.toUpperCase();
    const svcCurrency  = pricing.currency?.toUpperCase();

    // Skip pricing comparison when currencies differ
    if (currency && svcCurrency && currency !== svcCurrency) return 0.5;

    if (min != null && max != null) {
      if (servicePrice >= min && servicePrice <= max) return 1.0;
      const rangeWidth = max - min || 1;
      const overshoot  = Math.max(0, servicePrice - max);
      const undershoot = Math.max(0, min - servicePrice);
      if (undershoot > 0)                  return 0.7;   // under-bid
      if (overshoot <= rangeWidth * 0.20)  return 0.5;   // slightly over
      return 0.1;
    }

    if (max != null) {
      if (servicePrice <= max)         return 1.0;
      if (servicePrice <= max * 1.20)  return 0.5;
      return 0.1;
    }

    if (min != null) {
      return servicePrice >= min ? 1.0 : 0.3;
    }

    return 0.5;
  }

  // ─── Utility Helpers ─────────────────────────────────────────────────────────

  /**
   * Returns the best available GPS reference point for a task.
   * Prefers the live GPS fix captured at task-posting time for greater accuracy,
   * falling back to the registered address coordinates.
   */
  private getTaskCoordinates(task: Task): Coordinates | null {
    const gps = task.locationContext?.gpsLocationAtPosting;
    if (gps?.latitude != null && gps?.longitude != null) {
      return { latitude: gps.latitude, longitude: gps.longitude };
    }
    return task.locationContext?.registeredLocation?.gpsCoordinates ?? null;
  }

  /**
   * Extracts the key terms used during this matching run and stores them
   * in matchingCriteria.searchTerms for audit and debugging purposes.
   * Combines tokenised title words with explicit tags, capped at 20 terms.
   */
  private extractSearchTerms(task: Task): string[] {
    const fromTitle = this.tokenize(task.title);
    const fromTags  = (task.tags ?? []).map((t) => t.toLowerCase().trim());
    return [...new Set([...fromTitle, ...fromTags])].slice(0, 20);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * Shared matching service instance used by TaskService and bound to TaskModel
 * at application startup via taskMatchingService.bindToModel().
 *
 * To use a custom config (e.g. in tests or for a specific tenant):
 *   new TaskMatchingService({ ...TaskMatchingService.DEFAULT_CONFIG, maxDistanceKm: 30 })
 */
export const taskMatchingService = new TaskMatchingService();