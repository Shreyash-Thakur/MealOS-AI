/**
 * Realistic Mumbai restaurant fixtures for MockSwiggyMCPClient.
 * Bandra West coordinates: 19.0596, 72.8295.
 *
 * These are the post-normalization MealOS types (Restaurant), NOT raw Swiggy
 * API payloads. The mock returns them directly; the real client normalises to
 * this shape.
 *
 * Source: docs/SWIGGY_MCP.md §9 Mock Data Fixtures (adapted to types/swiggy.ts).
 */

import type { Restaurant, MenuItem } from '@/types/swiggy'
import type { SwiggyRestaurantId, Rupees, Minutes } from '@/types/primitives'

// Helper casts — branded primitives are compile-time only.
const id  = (s: string) => s as SwiggyRestaurantId
const rs  = (n: number) => n as Rupees
const min = (n: number) => n as Minutes

const haldirams: Restaurant = {
  restaurantId: id('rms_36291'),
  name: "Haldiram's Minute Khana",
  rating: 4.3,
  deliveryTimeMin: min(25),
  deliveryFee: rs(0),
  minOrderValue: rs(149),
  cuisineTypes: ['North Indian', 'Sweets', 'Snacks'],
  topItems: [
    { name: 'Dal Khichdi',   price: rs(149), isVeg: true  },
    { name: 'Palak Khichdi', price: rs(159), isVeg: true  },
    { name: 'Jeera Rice + Dal', price: rs(169), isVeg: true },
  ] satisfies MenuItem[],
}

const bowlCompany: Restaurant = {
  restaurantId: id('rms_44102'),
  name: 'The Bowl Company',
  rating: 4.1,
  deliveryTimeMin: min(32),
  deliveryFee: rs(30),
  minOrderValue: rs(199),
  cuisineTypes: ['Healthy Food', 'Continental', 'Salads'],
  topItems: [
    { name: 'Chicken Tikka Bowl', price: rs(319), isVeg: false, proteinG: 38 as import('@/types/primitives').Grams },
    { name: 'Tomato Basil Soup',  price: rs(179), isVeg: true  },
    { name: 'Grilled Veggie Bowl', price: rs(249), isVeg: true  },
  ] satisfies MenuItem[],
}

const behrouzBiryani: Restaurant = {
  restaurantId: id('rms_55891'),
  name: 'Behrouz Biryani',
  rating: 4.4,
  deliveryTimeMin: min(38),
  deliveryFee: rs(0),
  minOrderValue: rs(299),
  cuisineTypes: ['Biryani', 'Mughlai'],
  topItems: [
    { name: 'Dum Gosht Biryani',     price: rs(379), isVeg: false },
    { name: 'Chicken Nizami Handi',  price: rs(349), isVeg: false },
    { name: 'Veg Dum Biryani',       price: rs(299), isVeg: true  },
  ] satisfies MenuItem[],
}

const greenBowl: Restaurant = {
  restaurantId: id('rms_66123'),
  name: 'Green Bowl',
  rating: 4.0,
  deliveryTimeMin: min(22),
  deliveryFee: rs(20),
  minOrderValue: rs(149),
  cuisineTypes: ['Healthy Food', 'Salads', 'Juices'],
  topItems: [
    { name: 'Quinoa Salad',       price: rs(229), isVeg: true  },
    { name: 'Protein Power Bowl', price: rs(279), isVeg: false, proteinG: 30 as import('@/types/primitives').Grams },
  ] satisfies MenuItem[],
}

/** Full fixture set — all open, all within Bandra delivery range. */
export const mockRestaurants: Restaurant[] = [
  haldirams,
  bowlCompany,
  behrouzBiryani,
  greenBowl,
]

/**
 * Vegetarian-only restaurants (isVeg filter applied).
 * Used in tests that verify the vegetarianOnly flag.
 */
export const vegOnlyRestaurants: Restaurant[] = [haldirams, greenBowl]

/**
 * High-protein restaurants for fitness scenarios.
 * The Bowl Company and Green Bowl have proteinG on key items.
 */
export const highProteinRestaurants: Restaurant[] = [bowlCompany, greenBowl]
