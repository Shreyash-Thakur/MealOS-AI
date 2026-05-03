export type CardType = "food" | "instamart" | "dineout";

export interface Card {
  type: CardType;
  name: string;
  // Food
  price?: number;
  deliveryTime?: string;
  // Instamart
  ingredients?: string[];
  totalCost?: number;
  // Dineout
  restaurant?: string;
  offer?: string;
}

export interface Message {
  id: string;
  role: "user" | "ai";
  text?: string;
  cards?: Card[];
}
