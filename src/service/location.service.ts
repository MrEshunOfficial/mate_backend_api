// services/location/location.service.ts

import { OpenStreetMapLocationService, osmLocationService } from "../config/opentreetmap.location.service";
import { Coordinates, UserLocation } from "../types/location.types";

// ─── Input / Output Types ─────────────────────────────────────────────────────

export interface LocationEnrichmentInput {
  ghanaPostGPS: string;
  nearbyLandmark?: string;
  /** Optional — pass when the device supplies a live GPS fix for a faster path */
  gpsCoordinates?: Coordinates;
}

export interface LocationEnrichmentOutput {
  success: boolean;
  /** Fully populated UserLocation — ready to be persisted on any owning entity */
  location?: UserLocation;
  /**
   * Fields that OSM could not resolve (e.g. district, city).
   * The location is still returned — callers decide whether to surface
   * a warning or proceed silently.
   */
  missingFields?: string[];
  error?: string;
}

export interface LocationVerificationOutput {
  verified: boolean;
  /**
   * Human-readable list of fields where the stored value differs from
   * what a fresh enrichment returned. Empty when verified === true.
   */
  discrepancies: string[];
}

/**
 * Attaches a distanceKm field to any object that has a known location.
 * Used by provider search, task matching, and client-facing discovery flows.
 */
export type WithDistance<T> = T & { distanceKm: number };

// ─── Completeness / Verification Config ──────────────────────────────────────

/** Fields that must be present for a location to be considered complete */
const IMPORTANT_FIELDS: (keyof UserLocation)[] = [
  "region",
  "city",
  "district",
  "gpsCoordinates",
];

/** Fields compared when re-verifying a stored location against a fresh lookup */
const VERIFICATION_FIELDS: (keyof UserLocation)[] = [
  "region",
  "city",
  "district",
  "locality",
];

/** Earth radius in kilometres — used by the Haversine formula */
const EARTH_RADIUS_KM = 6371;

// ─── Service ──────────────────────────────────────────────────────────────────

export class LocationService {
  constructor(
    private readonly osmService: OpenStreetMapLocationService
  ) {}

  // ─── Enrichment ─────────────────────────────────────────────────────────────

  /**
   * Core enrichment method used by all domain services that store location data.
   *
   * Takes the user-supplied input and returns a fully populated UserLocation
   * ready to be saved on any entity that holds the UserLocation shape:
   *   - ProviderProfile.locationData
   *   - ClientProfile.savedAddresses[]
   *   - Booking.serviceLocation
   *   - Task.locationContext.registeredLocation
   *
   * The caller never needs to know which geocoding provider was used —
   * that detail is encapsulated here and recorded in sourceProvider.
   */
  async enrichLocation(
    input: LocationEnrichmentInput
  ): Promise<LocationEnrichmentOutput> {
    const { ghanaPostGPS, nearbyLandmark, gpsCoordinates } = input;

    if (!ghanaPostGPS?.trim()) {
      return { success: false, error: "Ghana Post GPS code is required" };
    }

    const normalizedGPS = ghanaPostGPS.trim().toUpperCase();

    const result = await this.osmService.enrichLocationData(
      normalizedGPS,
      gpsCoordinates,
      nearbyLandmark
    );

    if (!result.success || !result.location) {
      return {
        success: false,
        error: result.error ?? "Location enrichment failed",
      };
    }

    const location: UserLocation = {
      // User-supplied — always preserved exactly as entered
      ghanaPostGPS:   normalizedGPS,
      nearbyLandmark: nearbyLandmark?.trim(),

      // OSM-resolved fields
      region:      result.location.region,
      city:        result.location.city,
      district:    result.location.district,
      locality:    result.location.locality,
      streetName:  result.location.streetName,
      houseNumber: result.location.houseNumber,

      // Prefer the OSM-resolved coordinate pair over the raw device input —
      // OSM may have corrected a slightly imprecise GPS fix
      gpsCoordinates: result.coordinates ?? result.location.gpsCoordinates,

      isAddressVerified: result.location.isAddressVerified ?? false,
      sourceProvider:    "openstreetmap",

      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const missingFields = this.getMissingFields(location);

    return { success: true, location, missingFields };
  }

  /**
   * Re-verifies a stored location by running fresh enrichment and comparing
   * key fields. Used by the admin "verify address" flow and
   * ProviderProfileService.verifyProviderAddress().
   *
   * Read-only — does NOT modify any document.
   * The caller is responsible for stamping isAddressVerified on the entity.
   */
  async verifyStoredLocation(
    stored: UserLocation
  ): Promise<LocationVerificationOutput> {
    if (!stored.ghanaPostGPS?.trim()) {
      return {
        verified: false,
        discrepancies: ["ghanaPostGPS is missing — cannot verify"],
      };
    }

    if (!stored.gpsCoordinates) {
      return {
        verified: false,
        discrepancies: [
          "gpsCoordinates missing — run enrichment before verifying",
        ],
      };
    }

    const fresh = await this.enrichLocation({
      ghanaPostGPS:   stored.ghanaPostGPS,
      nearbyLandmark: stored.nearbyLandmark,
      gpsCoordinates: stored.gpsCoordinates,
    });

    if (!fresh.success || !fresh.location) {
      return {
        verified: false,
        discrepancies: ["enrichment failed during verification"],
      };
    }

    const discrepancies = this.findDiscrepancies(stored, fresh.location);
    return { verified: discrepancies.length === 0, discrepancies };
  }

  // ─── Distance Calculation (public) ──────────────────────────────────────────

  /**
   * Calculates the straight-line distance in kilometres between two GPS
   * coordinate pairs using the Haversine formula.
   *
   * Used by:
   *   - ClientProfileService.getProvidersNearClient()
   *   - TaskService when attaching distances to matched providers
   *   - ProviderProfileService.getProvidersNearCoordinates()
   *   - Any caller that needs a point-to-point distance
   *
   * Returns Infinity when either coordinate is missing — callers can filter
   * or sort on this value safely without a null check.
   */
  calculateDistance(from: Coordinates, to: Coordinates): number {
    if (!from || !to) return Infinity;

    const dLat = this.toRadians(to.latitude  - from.latitude);
    const dLon = this.toRadians(to.longitude - from.longitude);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(from.latitude)) *
      Math.cos(this.toRadians(to.latitude))   *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((EARTH_RADIUS_KM * c).toFixed(2));
  }

  /**
   * Attaches a distanceKm field to each item in an array, measured from
   * a reference coordinate (e.g. client's default address, task location).
   *
   * Items with no resolvable coordinates get distanceKm: Infinity so they
   * naturally sort to the end when the caller sorts ascending by distance.
   *
   * @param from           - reference GPS point (client, task, or device location)
   * @param items          - candidates to annotate
   * @param getCoordinates - extracts GPS coords from each item
   *
   * Usage — providers near a client:
   *   const withDistances = locationService.attachDistances(
   *     clientProfile.savedAddresses[defaultIdx].gpsCoordinates,
   *     providers,
   *     (p) => p.locationData?.gpsCoordinates
   *   );
   *   withDistances.sort((a, b) => a.distanceKm - b.distanceKm);
   *
   * Usage — matched providers near a task:
   *   const withDistances = locationService.attachDistances(
   *     task.locationContext.gpsLocationAtPosting ?? task.locationContext.registeredLocation.gpsCoordinates,
   *     matchedProviders,
   *     (p) => p.locationData?.gpsCoordinates
   *   );
   */
  attachDistances<T>(
    from: Coordinates | undefined | null,
    items: T[],
    getCoordinates: (item: T) => Coordinates | undefined | null
  ): WithDistance<T>[] {
    if (!from) {
      return items.map((item) => ({ ...item, distanceKm: Infinity } as WithDistance<T>));
    }

    return items.map((item) => {
      const to = getCoordinates(item);
      return {
        ...item,
        distanceKm: to ? this.calculateDistance(from, to) : Infinity,
      } as WithDistance<T>;
    });
  }

  /**
   * Filters items by maximum distance from a reference point and sorts
   * the results nearest-first.
   *
   * Combines attachDistances + filter + sort into a single convenience call.
   * Used by ClientProfileService and TaskService when the caller needs a
   * pre-sorted, radius-bounded result set.
   *
   * @param from           - reference GPS point
   * @param items          - candidates to filter
   * @param getCoordinates - coordinate extractor for each item
   * @param maxDistanceKm  - radius cap (items beyond this are excluded)
   */
  filterByDistance<T>(
    from: Coordinates | undefined | null,
    items: T[],
    getCoordinates: (item: T) => Coordinates | undefined | null,
    maxDistanceKm: number
  ): WithDistance<T>[] {
    return this.attachDistances(from, items, getCoordinates)
      .filter((item) => item.distanceKm <= maxDistanceKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  /**
   * Returns the single nearest item from a list of candidates.
   * Useful for "find closest provider" or "find closest saved address" lookups.
   * Returns null when items is empty or no coordinates can be resolved.
   */
  findNearest<T>(
    from: Coordinates,
    items: T[],
    getCoordinates: (item: T) => Coordinates | undefined | null
  ): WithDistance<T> | null {
    if (!items.length) return null;

    const withDistances = this.attachDistances(from, items, getCoordinates);
    const nearest = withDistances.reduce((prev, curr) =>
      curr.distanceKm < prev.distanceKm ? curr : prev
    );

    return nearest.distanceKm === Infinity ? null : nearest;
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private getMissingFields(location: UserLocation): string[] {
    return IMPORTANT_FIELDS.filter((field) => !location[field]);
  }

  /**
   * Compares stored vs fresh values for fields that indicate whether the
   * stored address is still accurate. Only flags fields where both sides
   * have a value but they differ — does not flag fields OSM simply couldn't
   * resolve on the fresh run.
   */
  private findDiscrepancies(
    stored: UserLocation,
    fresh: UserLocation
  ): string[] {
    return VERIFICATION_FIELDS.filter(
      (field) =>
        stored[field] &&
        fresh[field] &&
        stored[field] !== fresh[field]
    );
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * Shared instance injected by default into all domain services that need
 * location enrichment or distance calculation.
 *
 * In tests, construct a fresh LocationService with a mocked osmService
 * and pass it to the domain service constructor instead.
 */
export const locationService = new LocationService(osmLocationService);