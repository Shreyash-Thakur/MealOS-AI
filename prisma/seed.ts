/**
 * prisma/seed.ts
 * MealOS AI — Development Seed Script
 *
 * Creates two test users with realistic memory profiles and four completed
 * situations covering the primary MealOS workflows: sick, broke, protein
 * goal, and date planning.
 *
 * Run:
 *   npx tsx prisma/seed.ts
 *   -- or --
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
 *
 * Prerequisites:
 *   DATABASE_URL must be set in .env
 *   npx prisma generate must have been run
 */

import {
  PrismaClient,
  MemorySource,
  SituationType,
  SituationStatus,
  PrimaryPath,
  ActionType,
} from "@prisma/client";

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Subtract days from today for realistic created_at timestamps. */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/** Subtract hours from today. */
function hoursAgo(n: number): Date {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEED DATA DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Starting MealOS seed...");

  // ── 1. Clean existing seed data ──────────────────────────────────────────
  // Delete in reverse FK order to satisfy referential integrity.
  // Hardcoded seed user IDs — valid UUID v4 format, used for idempotent cleanup
  const SEED_USER_IDS = [
    "00000000-0000-4001-a000-000000000001",
    "00000000-0000-4001-a000-000000000002",
  ];

  await prisma.userAction.deleteMany({
    where: { userId: { in: SEED_USER_IDS } },
  });
  await prisma.recommendation.deleteMany({
    where: { userId: { in: SEED_USER_IDS } },
  });
  await prisma.situation.deleteMany({
    where: { userId: { in: SEED_USER_IDS } },
  });
  await prisma.userMemoryFact.deleteMany({
    where: { userId: { in: SEED_USER_IDS } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: SEED_USER_IDS } },
  });

  console.log("Cleaned up existing seed data.");

  // ── 2. Create users ───────────────────────────────────────────────────────

  const priya = await prisma.user.create({
    data: {
      id: "00000000-0000-4001-a000-000000000001",
      clerkId: "user_seed_priya_sharma_mealos_dev",
      email: "priya.sharma.seed@mealos.dev",
      name: "Priya Sharma",
      phone: "+919876543210",
      lastActiveAt: hoursAgo(2),
    },
  });

  const arjun = await prisma.user.create({
    data: {
      id: "00000000-0000-4001-a000-000000000002",
      clerkId: "user_seed_arjun_mehta_mealos_dev",
      email: "arjun.mehta.seed@mealos.dev",
      name: "Arjun Mehta",
      phone: "+919988776655",
      lastActiveAt: hoursAgo(1),
    },
  });

  console.log(`Created users: ${priya.name}, ${arjun.name}`);

  // ── 3. Create memory facts — Priya Sharma ─────────────────────────────────
  // Priya: vegetarian, Mumbai Bandra, intermediate cook, Rs 350/day budget,
  //        shellfish allergy, prefers South Indian and Italian.

  await prisma.userMemoryFact.createMany({
    data: [
      {
        userId: priya.id,
        factKey: "dietary.restrictions",
        factValue: ["vegetarian"],
        source: MemorySource.ONBOARDING,
        confidence: 1.0,
        timesConfirmed: 12,
        lastConfirmedAt: daysAgo(3),
        expiresAt: null,
      },
      {
        userId: priya.id,
        factKey: "dietary.allergies",
        factValue: ["shellfish"],
        source: MemorySource.ONBOARDING,
        confidence: 1.0,
        timesConfirmed: 5,
        lastConfirmedAt: daysAgo(10),
        expiresAt: null,
      },
      {
        userId: priya.id,
        factKey: "budget.daily_food_target",
        factValue: 350,
        source: MemorySource.ONBOARDING,
        confidence: 1.0,
        timesConfirmed: 8,
        lastConfirmedAt: daysAgo(2),
        // Soft fact: re-evaluated after 30 days of no mention
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      {
        userId: priya.id,
        factKey: "budget.dining_out_per_outing",
        factValue: 1500,
        source: MemorySource.AGENT_INFERRED,
        confidence: 0.75,
        timesConfirmed: 2,
        lastConfirmedAt: daysAgo(15),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      {
        userId: priya.id,
        factKey: "location.home",
        factValue: "Bandra West, Mumbai",
        source: MemorySource.ONBOARDING,
        confidence: 1.0,
        timesConfirmed: 20,
        lastConfirmedAt: daysAgo(1),
        expiresAt: null,
      },
      {
        userId: priya.id,
        factKey: "location.work",
        factValue: "Lower Parel, Mumbai",
        source: MemorySource.USER_EDITED,
        confidence: 1.0,
        timesConfirmed: 3,
        lastConfirmedAt: daysAgo(5),
        expiresAt: null,
      },
      {
        userId: priya.id,
        factKey: "kitchen.skill_level",
        factValue: "intermediate",
        source: MemorySource.ONBOARDING,
        confidence: 1.0,
        timesConfirmed: 4,
        lastConfirmedAt: daysAgo(14),
        expiresAt: null,
      },
      {
        userId: priya.id,
        factKey: "kitchen.equipment",
        factValue: ["gas stove", "pressure cooker", "mixer grinder", "microwave"],
        source: MemorySource.ONBOARDING,
        confidence: 1.0,
        timesConfirmed: 1,
        lastConfirmedAt: daysAgo(30),
        expiresAt: null,
      },
      {
        userId: priya.id,
        factKey: "household.size",
        factValue: 2,
        source: MemorySource.ONBOARDING,
        confidence: 1.0,
        timesConfirmed: 3,
        lastConfirmedAt: daysAgo(7),
        expiresAt: null,
      },
      {
        userId: priya.id,
        factKey: "fitness.protein_target",
        factValue: 60,
        source: MemorySource.ONBOARDING,
        confidence: 1.0,
        timesConfirmed: 2,
        lastConfirmedAt: daysAgo(20),
        expiresAt: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
      },
      {
        userId: priya.id,
        factKey: "preference.cuisines.liked",
        factValue: ["South Indian", "Italian", "Mughlai"],
        source: MemorySource.AGENT_INFERRED,
        confidence: 0.85,
        timesConfirmed: 6,
        lastConfirmedAt: daysAgo(4),
        expiresAt: null,
      },
      {
        userId: priya.id,
        factKey: "preference.cuisines.disliked",
        factValue: ["Very spicy street food"],
        source: MemorySource.CLARIFICATION,
        confidence: 0.9,
        timesConfirmed: 1,
        lastConfirmedAt: daysAgo(21),
        expiresAt: null,
      },
      {
        userId: priya.id,
        factKey: "pantry.staples",
        factValue: ["rice", "toor dal", "cooking oil", "salt", "turmeric", "cumin seeds", "onions"],
        source: MemorySource.USER_EDITED,
        confidence: 1.0,
        timesConfirmed: 1,
        lastConfirmedAt: daysAgo(7),
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    ],
  });

  // ── 4. Create memory facts — Arjun Mehta ──────────────────────────────────
  // Arjun: non-vegetarian, Bangalore Indiranagar, beginner cook,
  //        Rs 500/day budget, 150g protein goal, gym 5 days a week.

  await prisma.userMemoryFact.createMany({
    data: [
      {
        userId: arjun.id,
        factKey: "dietary.restrictions",
        factValue: [],
        source: MemorySource.ONBOARDING,
        confidence: 1.0,
        timesConfirmed: 5,
        lastConfirmedAt: daysAgo(8),
        expiresAt: null,
      },
      {
        userId: arjun.id,
        factKey: "dietary.allergies",
        factValue: [],
        source: MemorySource.ONBOARDING,
        confidence: 1.0,
        timesConfirmed: 1,
        lastConfirmedAt: daysAgo(25),
        expiresAt: null,
      },
      {
        userId: arjun.id,
        factKey: "budget.daily_food_target",
        factValue: 500,
        source: MemorySource.ONBOARDING,
        confidence: 1.0,
        timesConfirmed: 6,
        lastConfirmedAt: daysAgo(3),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      {
        userId: arjun.id,
        factKey: "budget.dining_out_per_outing",
        factValue: 3000,
        source: MemorySource.CLARIFICATION,
        confidence: 1.0,
        timesConfirmed: 1,
        lastConfirmedAt: daysAgo(1),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      {
        userId: arjun.id,
        factKey: "location.home",
        factValue: "Indiranagar, Bangalore",
        source: MemorySource.ONBOARDING,
        confidence: 1.0,
        timesConfirmed: 15,
        lastConfirmedAt: daysAgo(1),
        expiresAt: null,
      },
      {
        userId: arjun.id,
        factKey: "kitchen.skill_level",
        factValue: "beginner",
        source: MemorySource.ONBOARDING,
        confidence: 1.0,
        timesConfirmed: 3,
        lastConfirmedAt: daysAgo(12),
        expiresAt: null,
      },
      {
        userId: arjun.id,
        factKey: "kitchen.equipment",
        factValue: ["gas stove", "electric kettle"],
        source: MemorySource.ONBOARDING,
        confidence: 1.0,
        timesConfirmed: 1,
        lastConfirmedAt: daysAgo(25),
        expiresAt: null,
      },
      {
        userId: arjun.id,
        factKey: "household.size",
        factValue: 1,
        source: MemorySource.ONBOARDING,
        confidence: 1.0,
        timesConfirmed: 2,
        lastConfirmedAt: daysAgo(10),
        expiresAt: null,
      },
      {
        userId: arjun.id,
        factKey: "fitness.protein_target",
        factValue: 150,
        source: MemorySource.ONBOARDING,
        confidence: 1.0,
        timesConfirmed: 9,
        lastConfirmedAt: daysAgo(1),
        expiresAt: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
      },
      {
        userId: arjun.id,
        factKey: "fitness.gym_days",
        factValue: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        source: MemorySource.ONBOARDING,
        confidence: 1.0,
        timesConfirmed: 3,
        lastConfirmedAt: daysAgo(5),
        expiresAt: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
      },
      {
        userId: arjun.id,
        factKey: "fitness.calorie_target",
        factValue: 2800,
        source: MemorySource.ONBOARDING,
        confidence: 1.0,
        timesConfirmed: 2,
        lastConfirmedAt: daysAgo(15),
        expiresAt: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
      },
      {
        userId: arjun.id,
        factKey: "preference.cuisines.liked",
        factValue: ["North Indian", "Chinese", "Continental", "Mediterranean"],
        source: MemorySource.AGENT_INFERRED,
        confidence: 0.8,
        timesConfirmed: 4,
        lastConfirmedAt: daysAgo(6),
        expiresAt: null,
      },
      {
        userId: arjun.id,
        factKey: "pantry.staples",
        factValue: ["eggs", "cooking oil", "salt", "pepper", "oats"],
        source: MemorySource.USER_EDITED,
        confidence: 1.0,
        timesConfirmed: 1,
        lastConfirmedAt: daysAgo(5),
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    ],
  });

  console.log("Created memory facts for both users.");

  // ── 5. Situations + Recommendations + Actions ────────────────────────────

  // ─── Situation 1: Priya — Sick ────────────────────────────────────────────
  // Submitted 5 days ago at dinner time. Required clarification (canCook, alone).
  // Outcome: ordered Khichdi from Haldiram's. Rated 5 stars.

  const priySickSituation = await prisma.situation.create({
    data: {
      userId: priya.id,
      rawInput: "I'm feeling really sick, have a bad cold and high fever. Can't really function.",
      situationType: SituationType.SICK,
      context: {
        situationType: "sick",
        explicit: {
          canCook: false,
          alone: true,
        },
        inferred: {
          timeOfDay: "dinner",
          isWeekend: false,
          location: "home",
        },
        fromMemory: {
          dietType: "vegetarian",
          allergies: ["shellfish"],
          budget: 350,
          cookingSkill: "intermediate",
          homeLoc: "Bandra West, Mumbai",
          preferredCuisines: ["South Indian", "Italian", "Mughlai"],
        },
      },
      status: SituationStatus.COMPLETED,
      clarificationData: {
        passes: [
          {
            passNumber: 1,
            questions: [
              {
                id: "q1",
                text: "Are you feeling up to cooking, or do you need something delivered?",
                field: "canCook",
                type: "single_choice",
                options: [
                  { label: "I can manage something simple", value: true },
                  { label: "No, need delivery please", value: false },
                ],
              },
              {
                id: "q2",
                text: "Are you home alone, or is someone there who can help?",
                field: "alone",
                type: "single_choice",
                options: [
                  { label: "Home alone", value: true },
                  { label: "Someone is home with me", value: false },
                ],
              },
            ],
            answers: { q1: false, q2: true },
            askedAt: daysAgo(5).toISOString(),
            answeredAt: new Date(daysAgo(5).getTime() + 2 * 60 * 1000).toISOString(),
          },
        ],
      },
      createdAt: daysAgo(5),
      contextReadyAt: new Date(daysAgo(5).getTime() + 3 * 60 * 1000),
      planReadyAt: new Date(daysAgo(5).getTime() + 8 * 60 * 1000),
      completedAt: new Date(daysAgo(5).getTime() + 10 * 60 * 1000),
      lat: 19.0596,
      lng: 72.8295,
    },
  });

  const priySickRec = await prisma.recommendation.create({
    data: {
      situationId: priySickSituation.id,
      userId: priya.id,
      comparisonScores: {
        cook: {
          score: 18,
          estimatedCostInr: 40,
          estimatedTimeMin: 35,
          feasible: false,
          scoringFactors: { budgetFit: 24, timeFit: 10, contextFit: -16, nutritionFit: 0 },
          reason:
            "Cooking is feasible on cost but the user is sick and explicitly said they cannot cook. Context fit is strongly negative.",
        },
        order: {
          score: 86,
          estimatedCostInr: 160,
          estimatedTimeMin: 28,
          feasible: true,
          scoringFactors: { budgetFit: 22, timeFit: 22, contextFit: 25, nutritionFit: 17 },
          reason:
            "Delivery is the ideal fit. Khichdi is light, warm, and vegetarian. 28-minute delivery is fast. Well within the Rs 350 budget.",
        },
        dineOut: {
          score: 12,
          estimatedCostInr: 800,
          estimatedTimeMin: 90,
          feasible: false,
          scoringFactors: { budgetFit: 5, timeFit: 2, contextFit: -20, nutritionFit: 10 },
          reason:
            "Dine out is infeasible. The user is sick and alone. Travelling to a restaurant is not appropriate.",
        },
      },
      primaryPath: PrimaryPath.ORDER,
      explanation:
        "You're sick, alone, and in no state to cook — delivery is the right call. Khichdi from Haldiram's is light, warm, easily digestible, and matches your vegetarian diet. At Rs 160 it is well within your Rs 350 budget, leaving room for dinner or medicine if needed.",
      confidenceScore: 88,
      title: "Khichdi from Haldiram's",
      estimatedCost: 160,
      estimatedTimeMin: 28,
      calories: 380,
      proteinG: 11,
      carbsG: 62,
      fatG: 6,
      youtubeUrl: null,
      recipeSteps: null,
      instamartItems: null,
      swiggyData: {
        restaurantId: "swg_rst_haldirams_bandra_001",
        restaurantName: "Haldiram's",
        menuItemId: "swg_item_khichdi_veg_haldirams",
        menuItemName: "Dal Khichdi",
        deliveryEstimateMin: 28,
        deliveryCostInr: 30,
        deepLinkUrl:
          "https://www.swiggy.com/restaurants/haldirams-bandra/menu?item=khichdi&source=mealos&cart=1",
      },
      createdAt: new Date(daysAgo(5).getTime() + 8 * 60 * 1000),
    },
  });

  await prisma.userAction.create({
    data: {
      userId: priya.id,
      situationId: priySickSituation.id,
      recommendationId: priySickRec.id,
      actionType: ActionType.EXECUTED_ORDER,
      rating: 5,
      externalOrderId: "swg_ord_seed_20260701_001",
      createdAt: new Date(daysAgo(5).getTime() + 10 * 60 * 1000),
      updatedAt: new Date(daysAgo(5).getTime() + 65 * 60 * 1000),
    },
  });

  // ─── Situation 2: Priya — Broke ───────────────────────────────────────────
  // Submitted 2 days ago at lunch. No clarification needed (pantry known from memory).
  // Outcome: cooked Dal-Chawal. Rated 4 stars.

  const priyaBrokeSituation = await prisma.situation.create({
    data: {
      userId: priya.id,
      rawInput: "Super broke this week, spent too much on a concert. Barely have money for food.",
      situationType: SituationType.BROKE,
      context: {
        situationType: "broke",
        explicit: {
          budget: 120,
          canCook: true,
        },
        inferred: {
          timeOfDay: "lunch",
          isWeekend: false,
          location: "home",
        },
        fromMemory: {
          dietType: "vegetarian",
          allergies: ["shellfish"],
          budget: 120,
          cookingSkill: "intermediate",
          homeLoc: "Bandra West, Mumbai",
          kitchenEquipment: ["gas stove", "pressure cooker", "mixer grinder"],
          preferredCuisines: ["South Indian", "Italian", "Mughlai"],
        },
      },
      status: SituationStatus.COMPLETED,
      clarificationData: {
        passes: [
          {
            passNumber: 1,
            questions: [
              {
                id: "q1",
                text: "What can you comfortably spend on food today?",
                field: "budget",
                type: "single_choice",
                options: [
                  { label: "Under Rs 100", value: 80 },
                  { label: "Rs 100–150", value: 120 },
                  { label: "Rs 150–250", value: 200 },
                  { label: "Rs 250–350", value: 300 },
                ],
              },
            ],
            answers: { q1: 120 },
            askedAt: daysAgo(2).toISOString(),
            answeredAt: new Date(daysAgo(2).getTime() + 1 * 60 * 1000).toISOString(),
          },
        ],
      },
      createdAt: daysAgo(2),
      contextReadyAt: new Date(daysAgo(2).getTime() + 2 * 60 * 1000),
      planReadyAt: new Date(daysAgo(2).getTime() + 6 * 60 * 1000),
      completedAt: new Date(daysAgo(2).getTime() + 7 * 60 * 1000),
      lat: 19.0596,
      lng: 72.8295,
    },
  });

  const priyaBrokeRec = await prisma.recommendation.create({
    data: {
      situationId: priyaBrokeSituation.id,
      userId: priya.id,
      comparisonScores: {
        cook: {
          score: 91,
          estimatedCostInr: 30,
          estimatedTimeMin: 25,
          feasible: true,
          scoringFactors: { budgetFit: 25, timeFit: 22, contextFit: 24, nutritionFit: 20 },
          reason:
            "Dal-chawal uses pantry staples already on hand. Costs Rs 30, covers lunch and dinner, and is nutritionally complete. Perfect budget fit.",
        },
        order: {
          score: 38,
          estimatedCostInr: 99,
          estimatedTimeMin: 20,
          feasible: true,
          scoringFactors: { budgetFit: 14, timeFit: 20, contextFit: 4, nutritionFit: 0 },
          reason:
            "Cheapest delivery option is Rs 99 after discount and covers only one meal. Cooking at home saves Rs 69 and covers two meals.",
        },
        dineOut: {
          score: 3,
          estimatedCostInr: 600,
          estimatedTimeMin: 75,
          feasible: false,
          scoringFactors: { budgetFit: 0, timeFit: 5, contextFit: -2, nutritionFit: 0 },
          reason: "Dine out is out of budget. Minimum spend at any restaurant exceeds Rs 120.",
        },
      },
      primaryPath: PrimaryPath.COOK,
      explanation:
        "Dal-chawal is the clear winner. You have all the ingredients in your pantry (rice, toor dal, oil, salt, turmeric), it costs roughly Rs 30, takes 25 minutes in a pressure cooker, and covers both lunch and dinner — stretching your Rs 120 to cover the whole day.",
      confidenceScore: 93,
      title: "Dal-Chawal — Covers Lunch + Dinner",
      estimatedCost: 30,
      estimatedTimeMin: 25,
      calories: 420,
      proteinG: 14,
      carbsG: 74,
      fatG: 8,
      youtubeUrl: "https://www.youtube.com/watch?v=seed_dal_chawal_recipe_001",
      recipeSteps: [
        {
          step: 1,
          instruction: "Rinse 1 cup toor dal and 1.5 cups rice separately under cold water.",
          durationMin: 2,
          tip: "Soaking dal for 15 minutes reduces cooking time by 5 minutes.",
        },
        {
          step: 2,
          instruction:
            "Heat 1 tsp oil in the pressure cooker. Add 1 tsp cumin seeds. Let them splutter.",
          durationMin: 1,
        },
        {
          step: 3,
          instruction:
            "Add the rinsed dal with 3 cups water. Add 0.5 tsp turmeric and 0.5 tsp salt. Close the lid.",
          durationMin: 1,
        },
        {
          step: 4,
          instruction:
            "Pressure cook for 4 whistles on medium heat. Let the pressure release naturally.",
          durationMin: 15,
        },
        {
          step: 5,
          instruction:
            "Meanwhile, boil the rice in a separate pot with 3 cups water. Simmer for 10 minutes until water is absorbed.",
          durationMin: 12,
          tip: "Add a few drops of oil to prevent sticking.",
        },
        {
          step: 6,
          instruction: "Serve dal over rice. Add a squeeze of lemon if available.",
          durationMin: 1,
        },
      ],
      instamartItems: null,
      swiggyData: null,
      createdAt: new Date(daysAgo(2).getTime() + 6 * 60 * 1000),
    },
  });

  await prisma.userAction.create({
    data: {
      userId: priya.id,
      situationId: priyaBrokeSituation.id,
      recommendationId: priyaBrokeRec.id,
      actionType: ActionType.EXECUTED_COOK,
      rating: 4,
      externalOrderId: null,
      createdAt: new Date(daysAgo(2).getTime() + 7 * 60 * 1000),
      updatedAt: new Date(daysAgo(2).getTime() + 50 * 60 * 1000),
    },
  });

  // ─── Situation 3: Arjun — Protein Goal ────────────────────────────────────
  // Submitted this morning (8 hours ago). No clarification needed.
  // Outcome: executed cook. Rated 4 stars.

  const arjunProteinSituation = await prisma.situation.create({
    data: {
      userId: arjun.id,
      rawInput:
        "It's leg day today. I need to hit 150g protein. Help me plan what to eat for the whole day.",
      situationType: SituationType.NUTRITION_GOAL,
      context: {
        situationType: "nutrition_goal",
        explicit: {
          proteinTarget: 150,
          timeframe: "today",
        },
        inferred: {
          timeOfDay: "breakfast",
          isWeekend: false,
          location: "home",
        },
        fromMemory: {
          dietType: "non-vegetarian",
          allergies: [],
          budget: 500,
          cookingSkill: "beginner",
          kitchenEquipment: ["gas stove", "electric kettle"],
          homeLoc: "Indiranagar, Bangalore",
          proteinTarget: 150,
          calorieTarget: 2800,
          gymDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        },
      },
      status: SituationStatus.COMPLETED,
      clarificationData: null,
      createdAt: hoursAgo(8),
      contextReadyAt: hoursAgo(8),
      planReadyAt: new Date(hoursAgo(8).getTime() + 5 * 60 * 1000),
      completedAt: new Date(hoursAgo(8).getTime() + 6 * 60 * 1000),
      lat: 12.9716,
      lng: 77.6412,
    },
  });

  const arjunProteinRec = await prisma.recommendation.create({
    data: {
      situationId: arjunProteinSituation.id,
      userId: arjun.id,
      comparisonScores: {
        cook: {
          score: 82,
          estimatedCostInr: 280,
          estimatedTimeMin: 20,
          feasible: true,
          scoringFactors: { budgetFit: 24, timeFit: 22, contextFit: 18, nutritionFit: 18 },
          reason:
            "Eggs are in pantry, chicken breast can be ordered from Instamart in 15 minutes. Highest protein density per rupee. Fast preparation for a beginner cook.",
        },
        order: {
          score: 63,
          estimatedCostInr: 420,
          estimatedTimeMin: 35,
          feasible: true,
          scoringFactors: { budgetFit: 20, timeFit: 16, contextFit: 14, nutritionFit: 13 },
          reason:
            "The Bowl Company has a 42g protein chicken bowl for Rs 380. Good option for lunch but costs more and delivers slower than cooking.",
        },
        dineOut: {
          score: 22,
          estimatedCostInr: 900,
          estimatedTimeMin: 80,
          feasible: false,
          scoringFactors: { budgetFit: 8, timeFit: 4, contextFit: 10, nutritionFit: 0 },
          reason:
            "Dine out is inefficient for a nutrition goal day. Limited macro control, high cost, too much time away.",
        },
      },
      primaryPath: PrimaryPath.COOK,
      explanation:
        "Hitting 150g protein on a beginner cook budget requires combining home cooking with a smart Swiggy order. The plan: scrambled eggs now for the morning (36g protein, Rs 0 — you have eggs), a chicken tikka bowl from The Bowl Company at lunch (42g protein, Rs 380 delivered), and a high-protein dinner cooked at home with chicken breast from Instamart (52g protein, Rs 200). That puts you at 130g — close the gap with a Greek yogurt if available.",
      confidenceScore: 79,
      title: "Protein Day Plan: Eggs + Chicken Tikka Bowl + Instamart Chicken",
      estimatedCost: 580,
      estimatedTimeMin: 20,
      calories: 2650,
      proteinG: 130,
      carbsG: 180,
      fatG: 85,
      youtubeUrl: "https://www.youtube.com/watch?v=seed_scrambled_eggs_recipe_001",
      recipeSteps: [
        {
          step: 1,
          instruction:
            "Break 4 eggs into a bowl. Add a pinch of salt and pepper. Whisk well for 30 seconds.",
          durationMin: 1,
        },
        {
          step: 2,
          instruction:
            "Heat 1 tsp oil in a non-stick pan on low-medium heat. Pour in the egg mixture.",
          durationMin: 1,
        },
        {
          step: 3,
          instruction:
            "Gently fold the eggs with a spatula as they begin to set. Remove from heat while slightly underdone — residual heat finishes them.",
          durationMin: 3,
          tip: "Low heat and constant folding gives you creamy eggs, not rubbery ones.",
        },
        {
          step: 4,
          instruction: "Serve immediately with oat toast for additional carbs.",
          durationMin: 1,
        },
      ],
      instamartItems: [
        {
          itemId: "im_item_chicken_breast_400g",
          name: "Fresho Chicken Breast (boneless, 400g)",
          quantityNeeded: 1,
          unit: "pack",
          pricePerUnit: 199,
          imageUrl: "https://media.swiggy.com/instamart/chicken_breast_fresho.jpg",
          inStockConfirmed: true,
        },
        {
          itemId: "im_item_greek_yogurt_200g",
          name: "Epigamia Greek Yogurt Plain (200g)",
          quantityNeeded: 1,
          unit: "cup",
          pricePerUnit: 65,
          imageUrl: "https://media.swiggy.com/instamart/epigamia_greek_yogurt.jpg",
          inStockConfirmed: true,
        },
      ],
      swiggyData: {
        restaurantId: "swg_rst_the_bowl_company_indiranagar",
        restaurantName: "The Bowl Company",
        menuItemId: "swg_item_chicken_tikka_bowl",
        menuItemName: "Chicken Tikka Protein Bowl",
        deliveryEstimateMin: 32,
        deliveryCostInr: 40,
        deepLinkUrl:
          "https://www.swiggy.com/restaurants/the-bowl-company-indiranagar/menu?item=chicken-tikka-bowl&source=mealos&cart=1",
      },
      createdAt: new Date(hoursAgo(8).getTime() + 5 * 60 * 1000),
    },
  });

  await prisma.userAction.create({
    data: {
      userId: arjun.id,
      situationId: arjunProteinSituation.id,
      recommendationId: arjunProteinRec.id,
      actionType: ActionType.EXECUTED_COOK,
      rating: 4,
      externalOrderId: null,
      createdAt: new Date(hoursAgo(8).getTime() + 6 * 60 * 1000),
      updatedAt: new Date(hoursAgo(7).getTime()),
    },
  });

  // ─── Situation 4: Arjun — Date Planning ──────────────────────────────────
  // Submitted 1 day ago. Required budget and occasion clarification.
  // Outcome: booked Toscano Indiranagar for anniversary dinner. Rated 5 stars.

  const arjunDateSituation = await prisma.situation.create({
    data: {
      userId: arjun.id,
      rawInput:
        "Planning a special dinner tonight for my anniversary. Want to really impress. Any ideas?",
      situationType: SituationType.DATE_PLANNING,
      context: {
        situationType: "date_planning",
        explicit: {
          budget: 3000,
          alone: false,
          guestCount: 2,
          occasion: "anniversary",
          indoorOutdoor: "indoor",
        },
        inferred: {
          timeOfDay: "dinner",
          isWeekend: false,
          location: "home",
        },
        fromMemory: {
          dietType: "non-vegetarian",
          allergies: [],
          budget: 3000,
          homeLoc: "Indiranagar, Bangalore",
          preferredCuisines: ["North Indian", "Chinese", "Continental", "Mediterranean"],
        },
      },
      status: SituationStatus.COMPLETED,
      clarificationData: {
        passes: [
          {
            passNumber: 1,
            questions: [
              {
                id: "q1",
                text: "What's your budget for the evening?",
                field: "budget",
                type: "single_choice",
                options: [
                  { label: "Under Rs 1500", value: 1200 },
                  { label: "Rs 1500–2500", value: 2000 },
                  { label: "Rs 2500–4000", value: 3000 },
                  { label: "Rs 4000+", value: 4500 },
                ],
              },
              {
                id: "q2",
                text: "Are you thinking a cosy restaurant or somewhere with an outdoor or rooftop vibe?",
                field: "indoorOutdoor",
                type: "single_choice",
                options: [
                  { label: "Cosy indoor restaurant", value: "indoor" },
                  { label: "Rooftop or outdoor", value: "outdoor" },
                  { label: "Either works", value: "either" },
                ],
              },
              {
                id: "q3",
                text: "Is this your first date or an established partner?",
                field: "occasion",
                type: "single_choice",
                options: [
                  { label: "First date", value: "first_date" },
                  { label: "Anniversary / established partner", value: "anniversary" },
                ],
              },
            ],
            answers: { q1: 3000, q2: "indoor", q3: "anniversary" },
            askedAt: daysAgo(1).toISOString(),
            answeredAt: new Date(daysAgo(1).getTime() + 3 * 60 * 1000).toISOString(),
          },
        ],
      },
      createdAt: daysAgo(1),
      contextReadyAt: new Date(daysAgo(1).getTime() + 4 * 60 * 1000),
      planReadyAt: new Date(daysAgo(1).getTime() + 10 * 60 * 1000),
      completedAt: new Date(daysAgo(1).getTime() + 11 * 60 * 1000),
      lat: 12.9716,
      lng: 77.6412,
    },
  });

  const arjunDateRec = await prisma.recommendation.create({
    data: {
      situationId: arjunDateSituation.id,
      userId: arjun.id,
      comparisonScores: {
        cook: {
          score: 15,
          estimatedCostInr: 350,
          estimatedTimeMin: 60,
          feasible: false,
          scoringFactors: { budgetFit: 22, timeFit: 8, contextFit: -15, nutritionFit: 0 },
          reason:
            "Cooking for an anniversary is technically feasible but not the right call. Beginner skill level + high-stakes occasion = risk. Context fit is strongly negative.",
        },
        order: {
          score: 30,
          estimatedCostInr: 1200,
          estimatedTimeMin: 40,
          feasible: true,
          scoringFactors: { budgetFit: 18, timeFit: 14, contextFit: -2, nutritionFit: 0 },
          reason:
            "Delivery is fine for casual but feels low-effort for an anniversary. The ambience gap cannot be filled by food delivery.",
        },
        dineOut: {
          score: 94,
          estimatedCostInr: 2800,
          estimatedTimeMin: 90,
          feasible: true,
          scoringFactors: { budgetFit: 23, timeFit: 24, contextFit: 25, nutritionFit: 22 },
          reason:
            "Dine out is the clear winner for an anniversary. Toscano Indiranagar is Italian, intimate, candlelit, and Rs 2800 for two is within budget. 7 PM tables available tonight.",
        },
      },
      primaryPath: PrimaryPath.DINE_OUT,
      explanation:
        "For an anniversary dinner you want ambience and a memorable experience — both of which only a restaurant can deliver. Toscano in Indiranagar is an Italian fine-casual restaurant with candlelit tables, an extensive wine list, and a strong non-vegetarian menu. At Rs 2800 for two it sits comfortably within your Rs 3000 budget. Tables at 7 PM and 8:30 PM are available tonight — book now as Saturday slots fill up by afternoon.",
      confidenceScore: 91,
      title: "Toscano, Indiranagar — Anniversary Dinner for Two",
      estimatedCost: 2800,
      estimatedTimeMin: 90,
      calories: null,
      proteinG: null,
      carbsG: null,
      fatG: null,
      youtubeUrl: null,
      recipeSteps: null,
      instamartItems: null,
      swiggyData: {
        dineoutPlaceId: "swg_dineout_toscano_indiranagar_001",
        dineoutPlaceName: "Toscano",
        availableSlots: [
          { date: daysAgo(1).toISOString().split("T")[0], time: "19:00", tableSize: 2 },
          { date: daysAgo(1).toISOString().split("T")[0], time: "20:30", tableSize: 2 },
        ],
        bookingUrl:
          "https://www.swiggy.com/dineout/toscano-indiranagar-bangalore/book?party=2&time=19:00&source=mealos",
      },
      createdAt: new Date(daysAgo(1).getTime() + 10 * 60 * 1000),
    },
  });

  await prisma.userAction.create({
    data: {
      userId: arjun.id,
      situationId: arjunDateSituation.id,
      recommendationId: arjunDateRec.id,
      actionType: ActionType.EXECUTED_DINEOUT,
      rating: 5,
      externalOrderId: "swg_dineout_booking_seed_20260705_001",
      createdAt: new Date(daysAgo(1).getTime() + 11 * 60 * 1000),
      updatedAt: new Date(daysAgo(1).getTime() + 180 * 60 * 1000),
    },
  });

  // ── 6. Summary ────────────────────────────────────────────────────────────
  const userCount = await prisma.user.count();
  const factCount = await prisma.userMemoryFact.count();
  const situationCount = await prisma.situation.count();
  const recommendationCount = await prisma.recommendation.count();
  const actionCount = await prisma.userAction.count();

  console.log("\nSeed complete:");
  console.log(`  Users:           ${userCount}`);
  console.log(`  Memory facts:    ${factCount}`);
  console.log(`  Situations:      ${situationCount}`);
  console.log(`  Recommendations: ${recommendationCount}`);
  console.log(`  User actions:    ${actionCount}`);
}

// ─────────────────────────────────────────────────────────────────────────────

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
