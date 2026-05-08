export type Recipe = {
  id: number;
  name: string;
  time: string;
  cal: string;
  serves: string;
  difficulty: "Easy" | "Medium" | "Advanced";
  price: string;
  rating: string;
  tags: string[];
  imageUrl: string;
};

export type Ingredient = { name: string; qty: string; icon: string; imageUrl: string };
export type Step = { title: string; detail: string; time: string };
export type Restaurant = {
  id: number;
  name: string;
  cuisine: string;
  rating: string;
  time: string;
  distance: string;
  priceFor2: string;
  offer: string;
  veg: boolean;
  imageUrl: string;
};
export type DineoutPlace = {
  id: number;
  name: string;
  cuisine: string;
  ambience: string;
  rating: string;
  priceFor2: string;
  availability: string;
  tags: string[];
  imageUrl: string;
};

const AREAS = ["Bandra", "Andheri", "Powai", "Juhu", "Worli", "Lower Parel", "Malad", "Ghatkopar"];

function expand<T>(items: T[], count: number, map: (item: T, i: number) => T): T[] {
  return Array.from({ length: count }, (_, i) => map(items[i % items.length], i));
}

function cuisineImageUrl(kind: "food" | "restaurant" | "dineout" | "ingredient", hint: string, i: number): string {
  const sanitized = hint
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const baseTag =
    kind === "ingredient"
      ? "ingredient food macro"
      : kind === "dineout"
        ? "restaurant interior dining ambience"
        : kind === "restaurant"
          ? "restaurant cuisine meal"
          : "food dish cuisine plate";
  const query = encodeURIComponent(`${baseTag} ${sanitized}`);
  const size = kind === "ingredient" ? "240x240" : kind === "dineout" ? "900x520" : "640x420";
  return `https://source.unsplash.com/${size}/?${query}&sig=${i + 1}`;
}

const baseRecipes: Recipe[] = [
  { id: 1, name: "Avocado Grain Bowl", time: "20 min", cal: "420 kcal", serves: "1", difficulty: "Easy", price: "Rs 380", rating: "4.8", tags: ["Healthy", "Vegan"], imageUrl: cuisineImageUrl("food", "avocado grain bowl vegan", 1) },
  { id: 2, name: "Paneer Tikka Masala", time: "35 min", cal: "560 kcal", serves: "2", difficulty: "Medium", price: "Rs 520", rating: "4.9", tags: ["Indian", "Vegetarian"], imageUrl: cuisineImageUrl("food", "paneer tikka masala indian", 2) },
  { id: 3, name: "Thai Basil Stir-Fry", time: "18 min", cal: "380 kcal", serves: "2", difficulty: "Easy", price: "Rs 340", rating: "4.7", tags: ["Asian", "Quick"], imageUrl: cuisineImageUrl("food", "thai basil stir fry asian", 3) },
  { id: 4, name: "Mushroom Risotto", time: "40 min", cal: "490 kcal", serves: "2", difficulty: "Medium", price: "Rs 460", rating: "4.6", tags: ["Italian", "Comfort"], imageUrl: cuisineImageUrl("food", "mushroom risotto italian", 4) },
];

export const RECIPES: Recipe[] = expand(baseRecipes, 30, (r, i) => ({
  ...r,
  id: i + 1,
  name: `${r.name} - ${AREAS[i % AREAS.length]}`,
  time: `${18 + (i % 8) * 3} min`,
  cal: `${360 + (i % 10) * 30} kcal`,
  serves: `${1 + (i % 4)}`,
  difficulty: (["Easy", "Medium", "Advanced"] as const)[i % 3],
  price: `Rs ${320 + (i % 12) * 40}`,
  rating: (4.1 + (i % 8) * 0.1).toFixed(1),
  imageUrl: cuisineImageUrl("food", `${r.name} ${r.tags.join(" ")} ${r.difficulty}`, i + 10),
}));

export const INGREDIENTS: Ingredient[] = [
  { name: "Cherry Tomatoes", qty: "250g", icon: "Tm", imageUrl: cuisineImageUrl("ingredient", "cherry tomatoes", 101) }, { name: "Avocado", qty: "2 pcs", icon: "Av", imageUrl: cuisineImageUrl("ingredient", "avocado", 102) },
  { name: "Brown Rice", qty: "1 cup", icon: "Br", imageUrl: cuisineImageUrl("ingredient", "brown rice", 103) }, { name: "Baby Spinach", qty: "100g", icon: "Sp", imageUrl: cuisineImageUrl("ingredient", "baby spinach", 104) },
  { name: "Olive Oil", qty: "3 tbsp", icon: "Oo", imageUrl: cuisineImageUrl("ingredient", "olive oil", 105) }, { name: "Lemon", qty: "1 pc", icon: "Lm", imageUrl: cuisineImageUrl("ingredient", "lemon", 106) },
  { name: "Feta Cheese", qty: "50g", icon: "Ft", imageUrl: cuisineImageUrl("ingredient", "feta cheese", 107) }, { name: "Chickpeas", qty: "1 can", icon: "Cp", imageUrl: cuisineImageUrl("ingredient", "chickpeas", 108) },
  { name: "Greek Yogurt", qty: "200g", icon: "Gy", imageUrl: cuisineImageUrl("ingredient", "greek yogurt", 109) }, { name: "Fresh Basil", qty: "1 bunch", icon: "Bs", imageUrl: cuisineImageUrl("ingredient", "fresh basil", 110) },
  { name: "Bell Peppers", qty: "3 pcs", icon: "Bp", imageUrl: cuisineImageUrl("ingredient", "bell peppers", 111) }, { name: "Tofu Cubes", qty: "250g", icon: "Tf", imageUrl: cuisineImageUrl("ingredient", "tofu cubes", 112) },
  { name: "Almonds", qty: "100g", icon: "Am", imageUrl: cuisineImageUrl("ingredient", "almonds", 113) }, { name: "Quinoa", qty: "1 cup", icon: "Qn", imageUrl: cuisineImageUrl("ingredient", "quinoa", 114) },
  { name: "Broccoli", qty: "300g", icon: "Bc", imageUrl: cuisineImageUrl("ingredient", "broccoli", 115) }, { name: "Sweet Corn", qty: "2 cups", icon: "Sc", imageUrl: cuisineImageUrl("ingredient", "sweet corn", 116) },
];

export const COOKING_STEPS: Step[] = [
  { title: "Rinse and cook rice", detail: "Use 1:2 rice to water ratio. Simmer for 18 minutes.", time: "18 min" },
  { title: "Prep vegetables", detail: "Slice and rinse all produce. Keep ready by section.", time: "6 min" },
  { title: "Roast chickpeas", detail: "Add oil + salt + paprika. Roast till crispy.", time: "15 min" },
  { title: "Make dressing", detail: "Whisk lemon, olive oil, honey, and pepper.", time: "3 min" },
  { title: "Assemble", detail: "Layer grains, greens, toppings and drizzle dressing.", time: "2 min" },
  { title: "Warm serving bowls", detail: "Quick rinse with hot water keeps food warm longer.", time: "2 min" },
  { title: "Taste and adjust", detail: "Balance salt, acid, and sweetness before serving.", time: "3 min" },
  { title: "Final garnish", detail: "Finish with herbs and citrus zest.", time: "1 min" },
];

const baseRestaurants: Restaurant[] = [
  { id: 1, name: "Behrouz Biryani", cuisine: "Mughlai, Biryani", rating: "4.5", time: "28 min", distance: "2.1 km", priceFor2: "Rs 800", offer: "30% off", veg: false, imageUrl: cuisineImageUrl("restaurant", "biryani mughlai restaurant", 201) },
  { id: 2, name: "Wow Momo", cuisine: "Chinese, Momos", rating: "4.3", time: "22 min", distance: "1.4 km", priceFor2: "Rs 450", offer: "Free delivery", veg: false, imageUrl: cuisineImageUrl("restaurant", "momo chinese restaurant", 202) },
  { id: 3, name: "The Bowl Company", cuisine: "Healthy, Salads", rating: "4.6", time: "32 min", distance: "3.0 km", priceFor2: "Rs 600", offer: "Buy 1 Get 1", veg: true, imageUrl: cuisineImageUrl("restaurant", "healthy salad restaurant", 203) },
  { id: 4, name: "Faasos", cuisine: "Wraps, Fast Food", rating: "4.2", time: "18 min", distance: "0.9 km", priceFor2: "Rs 380", offer: "20% off", veg: false, imageUrl: cuisineImageUrl("restaurant", "wrap fast food restaurant", 204) },
];

export const RESTAURANTS: Restaurant[] = expand(baseRestaurants, 45, (r, i) => ({
  ...r,
  id: i + 1,
  name: `${r.name} - ${AREAS[i % AREAS.length]}`,
  time: `${18 + (i % 10) * 3} min`,
  distance: `${(0.9 + (i % 12) * 0.3).toFixed(1)} km`,
  priceFor2: `Rs ${380 + (i % 16) * 85}`,
  rating: (4.0 + (i % 9) * 0.1).toFixed(1),
  offer: i % 5 === 0 ? "Flat Rs 125 off" : r.offer,
  imageUrl: cuisineImageUrl("restaurant", `${r.name} ${r.cuisine}`, i + 210),
}));

const baseDineout: DineoutPlace[] = [
  { id: 1, name: "Saffron The Grand", cuisine: "Indian Fine Dining", ambience: "Romantic, Upscale", rating: "4.9", priceFor2: "Rs 3200", availability: "3 tables left", tags: ["Date Night", "Rooftop"], imageUrl: cuisineImageUrl("dineout", "fine dining indian interior", 301) },
  { id: 2, name: "Trattoria Cielo", cuisine: "Italian, Mediterranean", ambience: "Cozy, Candlelit", rating: "4.8", priceFor2: "Rs 2400", availability: "Available tonight", tags: ["Anniversary", "Wine Bar"], imageUrl: cuisineImageUrl("dineout", "italian restaurant candlelight", 302) },
  { id: 3, name: "Yauatcha Mumbai", cuisine: "Modern Chinese", ambience: "Chic, Contemporary", rating: "4.7", priceFor2: "Rs 2800", availability: "6 tables left", tags: ["Business Dinner", "Group"], imageUrl: cuisineImageUrl("dineout", "modern chinese restaurant", 303) },
];

export const DINEOUT_PLACES: DineoutPlace[] = expand(baseDineout, 26, (p, i) => ({
  ...p,
  id: i + 1,
  name: `${p.name} - ${AREAS[i % AREAS.length]}`,
  rating: (4.3 + (i % 6) * 0.1).toFixed(1),
  priceFor2: `Rs ${2200 + (i % 11) * 250}`,
  availability: i % 3 === 0 ? `${2 + (i % 6)} tables left` : "Available tonight",
  tags: [...p.tags, ["Live Music", "Chef Special", "Family", "Pet Friendly"][i % 4]],
  imageUrl: cuisineImageUrl("dineout", `${p.name} ${p.cuisine} ${p.ambience}`, i + 310),
}));

const baseLate = [
  { id: 1, name: "Dominos Pizza", cuisine: "Pizza, Fast Food", rating: "4.1", time: "22 min", distance: "1.2 km", priceFor2: "Rs 500", offer: "2 for 1 Late Night", imageUrl: cuisineImageUrl("restaurant", "pizza late night restaurant", 401) },
  { id: 2, name: "Burger King", cuisine: "Burgers", rating: "4.0", time: "18 min", distance: "0.7 km", priceFor2: "Rs 420", offer: "Open till 2am", imageUrl: cuisineImageUrl("restaurant", "burger fast food restaurant", 402) },
  { id: 3, name: "Roll House", cuisine: "Rolls, Snacks", rating: "4.4", time: "28 min", distance: "2.0 km", priceFor2: "Rs 350", offer: "Late Night Combos", imageUrl: cuisineImageUrl("restaurant", "rolls snacks restaurant", 403) },
];

export const LATENIGHT = expand(baseLate, 28, (r, i) => ({
  ...r,
  id: i + 1,
  name: `${r.name} - ${AREAS[i % AREAS.length]}`,
  time: `${16 + (i % 9) * 4} min`,
  distance: `${(0.6 + (i % 10) * 0.35).toFixed(1)} km`,
  priceFor2: `Rs ${300 + (i % 9) * 90}`,
  rating: (4.0 + (i % 8) * 0.1).toFixed(1),
  imageUrl: cuisineImageUrl("restaurant", `${r.name} ${r.cuisine} late night`, i + 410),
}));
