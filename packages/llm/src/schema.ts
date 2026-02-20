import { z } from "zod";

const boostLevel = z.enum(["low", "medium", "high"]);
const priceTier = z.enum(["cheap", "moderate", "expensive", "any"]);

export const IntentPlanSchema = z.object({
  isSearchQuery: z.boolean().optional(),
  query: z.string(),
  filters: z.object({
    geoRadiusKm: z.number().optional(),
    openNow: z.boolean().optional(),
    priceTier: priceTier.optional(),
  }),
  mustHaveFromReviews: z.array(z.string()),
  niceToHaveFromReviews: z.array(z.string()),
  boosts: z.object({
    distance: boostLevel,
    rating: boostLevel.optional(),
    reviewEvidence: boostLevel,
  }),
  sort: z.array(z.string()),
  warningsToCheck: z.array(z.string()),
  clarifyingQuestion: z.string().nullable().optional(),
});

export type IntentPlanOutput = z.infer<typeof IntentPlanSchema>;
