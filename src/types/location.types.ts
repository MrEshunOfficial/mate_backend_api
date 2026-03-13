// ─── Static Address ───────────────────────────────────────────────────────────

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface UserLocation {
  ghanaPostGPS: string;         // e.g. "GA-123-4567"
  nearbyLandmark?: string;

  // Auto-filled / verified
  region?: string;
  city?: string;
  district?: string;
  locality?: string;
  streetName?: string;
  houseNumber?: string;
  gpsCoordinates?: Coordinates;
  isAddressVerified?: boolean;
  sourceProvider?: "openstreetmap" | "google" | "ghanapost";

  createdAt?: Date;
  updatedAt?: Date;
}

// ─── Live GPS Capture ─────────────────────────────────────────────────────────

// Distinct from UserLocation — this is a momentary GPS fix, not a saved address
export interface GPSLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;   // metres — used to judge reliability before matching
  capturedAt: Date;
}

// ─── Task Location Context ────────────────────────────────────────────────────

// Task matching evaluates BOTH location sources; nearest radius wins
export interface TaskLocationContext {
  registeredLocation: UserLocation;   // from ClientProfile default address
  gpsLocationAtPosting?: GPSLocation; // live GPS when the task was created
  activeRadiusKm?: number;            // resolved and stored by the matching engine
}

// ─── Service Browse Context ───────────────────────────────────────────────────

export interface BrowseLocationContext {
  gpsLocation: GPSLocation;
  initialRadiusKm: number;       // e.g. 20
  expandedRadiusKm?: number;     // set after client hits "load more"
  isExpanded: boolean;
}

