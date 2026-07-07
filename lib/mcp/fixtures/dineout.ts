/**
 * Realistic Mumbai Dineout fixtures for MockSwiggyMCPClient.
 *
 * Types: DineoutVenue (types/swiggy.ts — post-normalization).
 * Source: docs/SWIGGY_MCP.md §9 Mock Data Fixtures (adapted to types/swiggy.ts).
 */

import type { DineoutVenue, DineoutReservation, DineoutAmbience } from '@/types/swiggy'
import type { DineoutVenueId, SwiggyOrderId, Rupees, ISODateTime } from '@/types/primitives'

const vid = (s: string) => s as DineoutVenueId
const rid = (s: string) => s as SwiggyOrderId
const rs  = (n: number) => n as Rupees

// ── Venue fixtures ──────────────────────────────────────────────────────────

const trattoriaCielo: DineoutVenue = {
  venueId: vid('do_88231'),
  name: 'Trattoria Cielo',
  cuisineTypes: ['Italian', 'Continental'],
  ambience: ['candlelit', 'romantic', 'outdoor'] satisfies DineoutAmbience[],
  pricePerPerson: rs(1200),
  rating: 4.6,
  availableSlots: ['7:30 PM', '8:00 PM', '9:00 PM'],
  isVegFriendly: true,
  distanceKm: 1.8,
  bookingUrl: 'https://www.swiggy.com/dineout/venue/do_88231',
}

const bastianBandra: DineoutVenue = {
  venueId: vid('do_91044'),
  name: 'Bastian Bandra',
  cuisineTypes: ['Seafood', 'Continental'],
  ambience: ['rooftop', 'casual'] satisfies DineoutAmbience[],
  pricePerPerson: rs(1400),
  rating: 4.5,
  availableSlots: ['8:00 PM', '8:30 PM'],
  isVegFriendly: false,
  distanceKm: 0.9,
  bookingUrl: 'https://www.swiggy.com/dineout/venue/do_91044',
}

const woodsideInn: DineoutVenue = {
  venueId: vid('do_77019'),
  name: 'Woodside Inn',
  cuisineTypes: ['American', 'Bar Food'],
  ambience: ['casual', 'sports-bar'] satisfies DineoutAmbience[],
  pricePerPerson: rs(800),
  rating: 4.2,
  availableSlots: ['7:00 PM', '8:00 PM', '9:30 PM'],
  isVegFriendly: true,
  distanceKm: 1.2,
  bookingUrl: 'https://www.swiggy.com/dineout/venue/do_77019',
}

const trishnaSeafood: DineoutVenue = {
  venueId: vid('do_60321'),
  name: 'Trishna',
  cuisineTypes: ['Seafood', 'Indian'],
  ambience: ['fine-dining', 'candlelit'] satisfies DineoutAmbience[],
  pricePerPerson: rs(1800),
  rating: 4.7,
  availableSlots: [],  // fully booked — for NO_AVAILABILITY tests
  isVegFriendly: false,
  distanceKm: 3.5,
  bookingUrl: 'https://www.swiggy.com/dineout/venue/do_60321',
}

/** Full venue list. */
export const mockDineoutVenues: DineoutVenue[] = [
  trattoriaCielo,
  bastianBandra,
  woodsideInn,
  trishnaSeafood,
]

/** Only venues with available slots — for standard search tests. */
export const availableDineoutVenues: DineoutVenue[] = [
  trattoriaCielo,
  bastianBandra,
  woodsideInn,
]

/** Romantic date-night venues (occasion='date' bias). */
export const dateDineoutVenues: DineoutVenue[] = [trattoriaCielo]

/**
 * Sample confirmed reservation returned by createDineoutReservation.
 * Matches the frozen DineoutReservation shape from types/swiggy.ts.
 */
export const mockReservation: DineoutReservation = {
  venueId: vid('do_88231'),
  venueName: 'Trattoria Cielo',
  dateTime: '2026-07-07T19:30:00+05:30' as ISODateTime,
  partySize: 2,
  status: 'confirmed',
  reservationId: rid('swo_mock_res_001'),
  bookingUrl: 'https://www.swiggy.com/dineout/reservation/mock_res_001',
}

export {
  trattoriaCielo,
  bastianBandra,
  woodsideInn,
  trishnaSeafood,
}
