"use client";

import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import {
  type WishlistGarmentItem,
  isGarmentWishlisted,
  toggleWishlist,
} from "@/lib/wishlist";
import { playWoodTap } from "@/lib/sound-fx";

export interface WishlistButtonProps {
  item: WishlistGarmentItem;
  variant?: "icon" | "button";
  className?: string;
  onToggled?: (isWishlisted: boolean) => void;
}

export function WishlistButton({
  item,
  variant = "icon",
  className = "",
  onToggled,
}: WishlistButtonProps) {
  const [wishlisted, setWishlisted] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    setWishlisted(isGarmentWishlisted(item.garmentId));

    const handleUpdate = () => {
      setWishlisted(isGarmentWishlisted(item.garmentId));
    };

    window.addEventListener("wishlist:updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("wishlist:updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [item.garmentId]);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    // Sound effect
    try {
      playWoodTap();
    } catch {
      // Sound FX fallback
    }

    // Trigger bounce
    setAnimating(true);
    setTimeout(() => setAnimating(false), 300);

    const nextState = await toggleWishlist(item);
    setWishlisted(nextState);
    if (onToggled) {
      onToggled(nextState);
    }
  }

  if (variant === "button") {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold transition active:scale-95 ${
          wishlisted
            ? "border-lotus/40 bg-lotus/10 text-lotus shadow-xs"
            : "border-sand bg-white text-stone-700 hover:border-lotus/50 hover:text-lotus"
        } ${className}`}
        title={wishlisted ? "Xóa khỏi danh sách yêu thích" : "Lưu vào danh sách yêu thích"}
      >
        <Heart
          className={`h-4 w-4 transition-transform duration-300 ${
            wishlisted ? "fill-lotus text-lotus" : "text-stone-400 group-hover:text-lotus"
          } ${animating ? "scale-125" : "scale-100"}`}
        />
        <span>{wishlisted ? "Đã lưu yêu thích" : "Lưu vào yêu thích"}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={wishlisted ? "Xóa khỏi danh sách yêu thích" : "Thêm vào danh sách yêu thích"}
      title={wishlisted ? "Bỏ yêu thích" : "Lưu yêu thích"}
      className={`group/btn relative flex h-9 w-9 items-center justify-center rounded-full border border-white/60 bg-white/85 backdrop-blur-md shadow-xs transition-all hover:bg-white hover:scale-105 active:scale-90 ${
        wishlisted ? "border-lotus/30 text-lotus shadow-lotus/10" : "text-stone-400 hover:text-lotus"
      } ${className}`}
    >
      <Heart
        className={`h-4.5 w-4.5 transition-transform duration-300 ${
          wishlisted ? "fill-lotus text-lotus" : "text-stone-400 group-hover/btn:text-lotus"
        } ${animating ? "scale-130" : "scale-100"}`}
      />
    </button>
  );
}
