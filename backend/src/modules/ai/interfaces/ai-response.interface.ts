export interface AdvisorProduct {
  garmentId: string;
  name: string;
  category: string;
  color: string;
  occasion: string;
  imageUrl: string;
  dailyPrice: number;
  depositAmount: number;
  size: string;
  reason: string;
  inStock: boolean;
}

export interface AdvisorTopic {
  title: string;
  assistantReply: string;
  recommendedProductIds: string[];
  reasons: Record<string, string>;
  products: AdvisorProduct[];
}

export interface ProductAdvisorResponse {
  topics: AdvisorTopic[];
}

export type IntentType = "search" | "general" | "other";

export interface IntentResult {
  intent: IntentType;
  confidence: number;
}

export interface ProductFilters {
  category?: string[];
  color?: string[];
  size?: string[];
  budgetMin?: number;
  budgetMax?: number;
  occasion?: string[];
  keyword?: string;
  excludeCategories?: string[];
  excludeProductIds?: string[];
  excludeColors?: string[];
  excludeSizes?: string[];
  excludeOccasions?: string[];
}

/**
 * Một mục khách muốn loại trừ khi hỏi "ngoài/khác/trừ...".
 * - category: bỏ cả danh mục (áo dài, cổ phục...)
 * - attribute: bỏ các sản phẩm cùng màu/size/dịp
 * - product: bỏ một mẫu cụ thể (mẫu trên, vừa gửi, hoặc tên khớp catalog)
 */
export interface ExclusionTarget {
  kind: "category" | "product" | "attribute";
  text: string;
  categories?: string[];
  colors?: string[];
  sizes?: string[];
  occasions?: string[];
  /** Các token nhận diện tên mẫu, dùng để khớp catalog. */
  nameTokens?: string[];
  /** "mẫu này/trên/vừa gửi" → lấy product card gần nhất trong history. */
  refersToLastProduct?: boolean;
  /** Tên các sản phẩm đã khớp được trong catalog (để đưa vào prompt). */
  matchedProductNames?: string[];
}

export interface QueryScope {
  filters: ProductFilters;
  exclusions: ExclusionTarget[];
  browse: boolean;
  isExclusionQuestion: boolean;
}

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
