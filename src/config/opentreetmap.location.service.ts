// services/openstreetmap-location.service.ts
import axios, { AxiosInstance } from "axios";
import { UserLocation, Coordinates } from "../types/location.types";

/**
 * OpenStreetMap Nominatim API Response Types
 */
interface NominatimAddress {
  house_number?: string;
  road?: string;
  suburb?: string;
  neighbourhood?: string;
  village?: string;
  town?: string;
  city?: string;
  municipality?: string;
  county?: string;
  state?: string;
  region?: string;
  postcode?: string;
  country?: string;
  country_code?: string;
}

interface NominatimReverseResponse {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  address: NominatimAddress;
  boundingbox: [string, string, string, string];
}

interface NominatimSearchResponse {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  address?: NominatimAddress;
  boundingbox: [string, string, string, string];
  importance: number;
}

interface LocationEnrichmentResult {
  success: boolean;
  location?: Partial<UserLocation>;
  coordinates?: Coordinates;
  rawResponse?: NominatimReverseResponse | NominatimSearchResponse;
  error?: string;
}

interface GeocodingResult {
  success: boolean;
  coordinates?: Coordinates;
  displayName?: string;
  address?: NominatimAddress;
  confidence?: number;
  error?: string;
}

export class OpenStreetMapLocationService {
  private client: AxiosInstance;
  private readonly baseURL = "https://nominatim.openstreetmap.org";
  private readonly userAgent: string;
  private readonly email: string;
  private readonly referer: string;
  private lastRequestTime: number = 0;
  private readonly minRequestInterval: number = 1500;
  private requestCount: number = 0;

  constructor(config?: { 
    userAgent?: string; 
    email?: string;
    referer?: string;
  }) {
    this.userAgent = config?.userAgent || "GhanaServicePlatform/1.0";
    this.email = config?.email || "christophereshun91@gmail.com";
    this.referer = config?.referer || "https://yourapp.com";

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 15000,
      headers: {
        "User-Agent": this.userAgent,
        "Referer": this.referer,
        "Accept": "application/json",
        "Accept-Language": "en",
      },
    });

    // Add response interceptor for better error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          console.error("Nominatim API Error:", {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data,
            headers: error.response.headers,
          });
        } else if (error.request) {
          console.error("Nominatim Network Error:", error.message);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Enhanced rate limiting with logging
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      console.log(`⏳ Rate limiting: waiting ${waitTime}ms before next request`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
    this.requestCount++;
    console.log(`📡 Nominatim request #${this.requestCount}`);
  }

  /**
   * Reverse Geocoding with improved error handling
   */
  async reverseGeocode(
    coordinates: Coordinates
  ): Promise<LocationEnrichmentResult> {
    try {
      console.log("🔍 Reverse geocoding:", coordinates);
      await this.enforceRateLimit();

      const response = await this.client.get<NominatimReverseResponse>(
        "/reverse",
        {
          params: {
            lat: coordinates.latitude,
            lon: coordinates.longitude,
            format: "json",
            addressdetails: 1,
            zoom: 18,
            // email is passed in headers via User-Agent
          },
        }
      );

      console.log("✅ Nominatim response received:", {
        lat: response.data.lat,
        lon: response.data.lon,
        display_name: response.data.display_name?.substring(0, 100),
      });

      if (!response.data || !response.data.address) {
        console.warn("⚠️ No address data in response");
        return {
          success: false,
          error: "No address data returned from Nominatim",
        };
      }

      const location = this.mapNominatimToGhanaLocation(response.data.address);
      location.gpsCoordinates = coordinates;
      location.isAddressVerified = true;
      location.sourceProvider = "openstreetmap";

      console.log("✅ Location enriched:", {
        region: location.region,
        city: location.city,
        district: location.district,
      });

      return {
        success: true,
        location,
        coordinates,
        rawResponse: response.data,
      };
    } catch (error) {
      console.error("❌ Reverse geocoding failed:", error);
      
      // Check for specific error types
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 429) {
          return {
            success: false,
            error: "Rate limit exceeded. Please wait before making more requests.",
          };
        }
        if (error.response?.status === 403) {
          return {
            success: false,
            error: "Access denied. Check your User-Agent and Referer headers.",
          };
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : "Reverse geocoding failed",
      };
    }
  }

  /**
   * Forward Geocoding with better validation
   */
  async geocode(query: string, countryCode = "gh"): Promise<GeocodingResult> {
    try {
      console.log("🔍 Geocoding query:", query);
      await this.enforceRateLimit();

      const response = await this.client.get<NominatimSearchResponse[]>(
        "/search",
        {
          params: {
            q: query,
            format: "json",
            addressdetails: 1,
            countrycodes: countryCode,
            limit: 1,
          },
        }
      );

      if (!response.data || response.data.length === 0) {
        console.warn("⚠️ No results found for:", query);
        return {
          success: false,
          error: `Location not found: ${query}`,
        };
      }

      const result = response.data[0];
      console.log("✅ Geocoding result:", {
        lat: result.lat,
        lon: result.lon,
        display_name: result.display_name?.substring(0, 100),
      });

      return {
        success: true,
        coordinates: {
          latitude: parseFloat(result.lat),
          longitude: parseFloat(result.lon),
        },
        displayName: result.display_name,
        address: result.address,
        confidence: result.importance,
      };
    } catch (error) {
      console.error("❌ Geocoding failed:", error);
      
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 429) {
          return {
            success: false,
            error: "Rate limit exceeded. Please wait before making more requests.",
          };
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : "Geocoding failed",
      };
    }
  }

  /**
   * Enhanced location enrichment with fallback strategy
   */
  async enrichLocationData(
    ghanaPostGPS: string,
    coordinates?: Coordinates,
    nearbyLandmark?: string
  ): Promise<LocationEnrichmentResult> {
    try {
      console.log("🌍 Enriching location data:", {
        ghanaPostGPS,
        hasCoordinates: !!coordinates,
        nearbyLandmark,
      });

      let finalCoordinates = coordinates;
      let reverseGeoResult: LocationEnrichmentResult | null = null;

      // Strategy 1: If coordinates provided, use reverse geocoding
      if (finalCoordinates) {
        console.log("📍 Using provided coordinates for reverse geocoding");
        reverseGeoResult = await this.reverseGeocode(finalCoordinates);

        if (reverseGeoResult.success && reverseGeoResult.location) {
          reverseGeoResult.location.ghanaPostGPS = ghanaPostGPS;
          if (nearbyLandmark) {
            reverseGeoResult.location.nearbyLandmark = nearbyLandmark;
          }
          return reverseGeoResult;
        } else {
          console.warn("⚠️ Reverse geocoding failed, trying geocoding...");
        }
      }

      // Strategy 2: Try geocoding the Ghana Post GPS
      if (ghanaPostGPS) {
        console.log("🔍 Attempting to geocode Ghana Post GPS");
        const geocodeResult = await this.geocode(ghanaPostGPS);

        if (geocodeResult.success && geocodeResult.coordinates) {
          finalCoordinates = geocodeResult.coordinates;
          
          // Try reverse geocoding with the found coordinates
          reverseGeoResult = await this.reverseGeocode(finalCoordinates);
          
          if (reverseGeoResult.success && reverseGeoResult.location) {
            reverseGeoResult.location.ghanaPostGPS = ghanaPostGPS;
            if (nearbyLandmark) {
              reverseGeoResult.location.nearbyLandmark = nearbyLandmark;
            }
            return reverseGeoResult;
          }
        }
      }

      // Strategy 3: Try geocoding with nearby landmark
      if (nearbyLandmark) {
        console.log("🏢 Attempting to geocode nearby landmark:", nearbyLandmark);
        const landmarkResult = await this.geocode(`${nearbyLandmark}, Ghana`);
        
        if (landmarkResult.success && landmarkResult.coordinates) {
          finalCoordinates = landmarkResult.coordinates;
          
          reverseGeoResult = await this.reverseGeocode(finalCoordinates);
          
          if (reverseGeoResult.success && reverseGeoResult.location) {
            reverseGeoResult.location.ghanaPostGPS = ghanaPostGPS;
            reverseGeoResult.location.nearbyLandmark = nearbyLandmark;
            return reverseGeoResult;
          }
        }
      }

      // Fallback: Return basic location with provided data
      console.warn("⚠️ All enrichment strategies failed, using basic data");
      return {
        success: true,
        location: {
          ghanaPostGPS,
          nearbyLandmark,
          gpsCoordinates: finalCoordinates,
          isAddressVerified: false,
          sourceProvider: "openstreetmap",
        },
        coordinates: finalCoordinates,
      };
    } catch (error) {
      console.error("❌ Location enrichment error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Location enrichment failed",
      };
    }
  }

  /**
   * Verify location with detailed logging
   */
  async verifyLocation(
    ghanaPostGPS: string,
    providedCoordinates: Coordinates
  ): Promise<{
    verified: boolean;
    confidence: number;
    actualLocation?: string;
    distanceKm?: number;
  }> {
    try {
      console.log("🔐 Verifying location:", {
        ghanaPostGPS,
        providedCoordinates,
      });

      const geocodeResult = await this.geocode(ghanaPostGPS);

      if (!geocodeResult.success || !geocodeResult.coordinates) {
        console.warn("⚠️ Could not geocode GPS code for verification");
        return {
          verified: false,
          confidence: 0,
        };
      }

      const distance = this.calculateDistance(
        providedCoordinates,
        geocodeResult.coordinates
      );

      const verified = distance < 0.5;
      const confidence = Math.max(0, 1 - distance / 5);

      console.log("✅ Verification complete:", {
        verified,
        confidence,
        distanceKm: distance,
      });

      return {
        verified,
        confidence,
        actualLocation: geocodeResult.displayName,
        distanceKm: distance,
      };
    } catch (error) {
      console.error("❌ Location verification error:", error);
      return {
        verified: false,
        confidence: 0,
      };
    }
  }

  /**
   * Search nearby places
   */
  async searchNearby(
    coordinates: Coordinates,
    query: string,
    radiusKm: number = 5
  ): Promise<GeocodingResult[]> {
    try {
      await this.enforceRateLimit();

      const bbox = this.createBoundingBox(coordinates, radiusKm);

      const response = await this.client.get<NominatimSearchResponse[]>(
        "/search",
        {
          params: {
            q: query,
            format: "json",
            addressdetails: 1,
            countrycodes: "gh",
            bounded: 1,
            viewbox: `${bbox.minLon},${bbox.maxLat},${bbox.maxLon},${bbox.minLat}`,
            limit: 10,
          },
        }
      );

      return response.data.map((result) => ({
        success: true,
        coordinates: {
          latitude: parseFloat(result.lat),
          longitude: parseFloat(result.lon),
        },
        displayName: result.display_name,
        address: result.address,
        confidence: result.importance,
      }));
    } catch (error) {
      console.error("❌ Nearby search error:", error);
      return [];
    }
  }

  /**
   * Improved Ghana location mapping
   */
  private mapNominatimToGhanaLocation(
    address: NominatimAddress
  ): Partial<UserLocation> {
    const location: Partial<UserLocation> = {
      region: address.state || address.region,
      city: address.city || address.town || address.municipality,
      district: address.county,
      locality: address.suburb || address.neighbourhood || address.village,
      streetName: address.road,
      houseNumber: address.house_number,
    };

    console.log("🗺️ Mapped location:", location);
    return location;
  }

  /**
   * Calculate distance between two coordinates
   */
  private calculateDistance(
    coord1: Coordinates,
    coord2: Coordinates
  ): number {
    const R = 6371;
    const dLat = this.toRadians(coord2.latitude - coord1.latitude);
    const dLon = this.toRadians(coord2.longitude - coord1.longitude);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(coord1.latitude)) *
        Math.cos(this.toRadians(coord2.latitude)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Create bounding box around a point
   */
  private createBoundingBox(
    center: Coordinates,
    radiusKm: number
  ): {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  } {
    const latDegreePerKm = 1 / 111;
    const lonDegreePerKm = 1 / (111 * Math.cos(this.toRadians(center.latitude)));

    return {
      minLat: center.latitude - radiusKm * latDegreePerKm,
      maxLat: center.latitude + radiusKm * latDegreePerKm,
      minLon: center.longitude - radiusKm * lonDegreePerKm,
      maxLon: center.longitude + radiusKm * lonDegreePerKm,
    };
  }

  /**
   * Batch geocode with automatic rate limiting
   */
  async batchGeocode(
    queries: string[]
  ): Promise<Map<string, GeocodingResult>> {
    const results = new Map<string, GeocodingResult>();
    console.log(`📦 Batch geocoding ${queries.length} queries`);

    for (const query of queries) {
      const result = await this.geocode(query);
      results.set(query, result);
    }

    return results;
  }

  /**
   * Get place details by OSM ID
   */
  async getPlaceDetails(
    osmType: "N" | "W" | "R",
    osmId: number
  ): Promise<LocationEnrichmentResult> {
    try {
      await this.enforceRateLimit();

      const response = await this.client.get<NominatimReverseResponse[]>(
        "/lookup",
        {
          params: {
            osm_ids: `${osmType}${osmId}`,
            format: "json",
            addressdetails: 1,
          },
        }
      );

      const data = response.data[0]; // lookup returns array

      if (!data) {
        return {
          success: false,
          error: "Place not found",
        };
      }

      const location = this.mapNominatimToGhanaLocation(data.address);
      location.gpsCoordinates = {
        latitude: parseFloat(data.lat),
        longitude: parseFloat(data.lon),
      };
      location.isAddressVerified = true;
      location.sourceProvider = "openstreetmap";

      return {
        success: true,
        location,
        coordinates: location.gpsCoordinates,
        rawResponse: data,
      };
    } catch (error) {
      console.error("❌ Place details error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get place details",
      };
    }
  }

  /**
   * Health check for the service
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    requestCount: number;
    lastRequestTime: Date;
  }> {
    return {
      healthy: true,
      requestCount: this.requestCount,
      lastRequestTime: new Date(this.lastRequestTime),
    };
  }
}

/**
 * Singleton instance - Update with your actual domain and email
 */
export const osmLocationService = new OpenStreetMapLocationService({
  userAgent: "GhanaServicePlatform/1.0",
  email: "christophereshun91@gmail.com",
  referer: "https://ghanaserviceplatform.com",
});