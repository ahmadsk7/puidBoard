"use client";

import { useState, useEffect } from "react";

/**
 * Hook to calculate the optimal scale factor for the DJ board
 * to fit within the viewport while maintaining aspect ratio.
 *
 * @param boardWidth - The natural width of the board in pixels
 * @param boardHeight - The natural height of the board in pixels
 * @param targetScreenPercentage - How much of the screen the board should occupy (0-1)
 * @returns The scale factor to apply to the board
 */
export function useBoardScale(
  boardWidth: number,
  boardHeight: number,
  targetScreenPercentage: number = 0.6
): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const calculateScale = () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Calculate scale factors for width and height
      const scaleX = (viewportWidth * targetScreenPercentage) / boardWidth;
      const scaleY = (viewportHeight * targetScreenPercentage) / boardHeight;

      // Use the smaller scale to ensure the board fits
      const optimalScale = Math.min(scaleX, scaleY);

      // Clamp between reasonable bounds
      const clampedScale = Math.max(0.3, Math.min(1.5, optimalScale));

      setScale(clampedScale);
    };

    // Calculate on mount
    calculateScale();

    // Recalculate on resize
    window.addEventListener("resize", calculateScale);

    return () => {
      window.removeEventListener("resize", calculateScale);
    };
  }, [boardWidth, boardHeight, targetScreenPercentage]);

  return scale;
}
