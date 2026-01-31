"use client";

import { useRef, useCallback, useState, useEffect } from "react";

export type JogWheelProps = {
  /** Deck identifier */
  deckId: "A" | "B";
  /** Accent color for the glow effect */
  accentColor: string;
  /** Size of the jog wheel in pixels */
  size?: number;
  /** Whether the deck is currently playing (affects spin animation) */
  isPlaying?: boolean;
  /** Callback when the wheel is scratched/spun */
  onScratch?: (delta: number) => void;
};

/**
 * Interactive jog wheel that spins when dragged.
 * Provides a realistic turntable feel with smooth rotation.
 */
export default function JogWheel({
  deckId,
  accentColor,
  size = 280,
  isPlaying = false,
  onScratch,
}: JogWheelProps) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const lastAngleRef = useRef(0);
  const velocityRef = useRef(0);
  const animationFrameRef = useRef<number>();

  const [rotation, setRotation] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Calculate angle from center of wheel to mouse position
  const getAngleFromCenter = useCallback((clientX: number, clientY: number) => {
    const wheel = wheelRef.current;
    if (!wheel) return 0;

    const rect = wheel.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const deltaX = clientX - centerX;
    const deltaY = clientY - centerY;

    // Returns angle in degrees, 0 at top, clockwise positive
    return Math.atan2(deltaX, -deltaY) * (180 / Math.PI);
  }, []);

  // Normalize angle difference to handle wrap-around
  const normalizeAngleDiff = useCallback((angle: number) => {
    while (angle > 180) angle -= 360;
    while (angle < -180) angle += 360;
    return angle;
  }, []);

  // Handle pointer down - start dragging
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    setIsDragging(true);
    velocityRef.current = 0;

    const angle = getAngleFromCenter(e.clientX, e.clientY);
    lastAngleRef.current = angle;

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [getAngleFromCenter]);

  // Handle pointer move - rotate wheel
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;

    const currentAngle = getAngleFromCenter(e.clientX, e.clientY);
    const angleDiff = normalizeAngleDiff(currentAngle - lastAngleRef.current);

    lastAngleRef.current = currentAngle;
    velocityRef.current = angleDiff * 0.8; // Store velocity for momentum

    setRotation(prev => prev + angleDiff);

    // Call scratch callback with normalized delta
    onScratch?.(angleDiff / 360);
  }, [getAngleFromCenter, normalizeAngleDiff, onScratch]);

  // Handle pointer up - release and apply momentum
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;

    isDraggingRef.current = false;
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    // Apply momentum spin
    const applyMomentum = () => {
      if (isDraggingRef.current) return;

      if (Math.abs(velocityRef.current) > 0.1) {
        setRotation(prev => prev + velocityRef.current);
        velocityRef.current *= 0.95; // Friction
        animationFrameRef.current = requestAnimationFrame(applyMomentum);
      }
    };

    if (Math.abs(velocityRef.current) > 1) {
      animationFrameRef.current = requestAnimationFrame(applyMomentum);
    }
  }, []);

  // Auto-spin when playing
  useEffect(() => {
    if (!isPlaying || isDragging) return;

    let lastTime = performance.now();
    const RPM = 33.33; // Vinyl RPM
    const degreesPerMs = (RPM * 360) / 60000;

    const spin = (currentTime: number) => {
      if (isDraggingRef.current) return;

      const elapsed = currentTime - lastTime;
      lastTime = currentTime;

      setRotation(prev => prev + degreesPerMs * elapsed);
      animationFrameRef.current = requestAnimationFrame(spin);
    };

    animationFrameRef.current = requestAnimationFrame(spin);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, isDragging]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return (
    <div
      ref={wheelRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: "relative",
        width: size,
        height: size,
        cursor: isDragging ? "grabbing" : "grab",
        touchAction: "none",
        userSelect: "none",
      }}
    >
      {/* Outer glow ring */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          boxShadow: isDragging
            ? `0 0 20px 6px ${accentColor}, inset 0 0 20px rgba(0,0,0,0.8)`
            : `0 0 12px 3px ${accentColor}, inset 0 0 15px rgba(0,0,0,0.7)`,
          transition: "box-shadow 0.2s ease",
          pointerEvents: "none",
        }}
      />

      {/* Rotating disc */}
      <img
        src="/assets/dj-controls/wheels/jog-wheel-disc.svg"
        alt={`Deck ${deckId} jog wheel`}
        draggable={false}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          transform: `rotate(${rotation}deg)`,
          pointerEvents: "none",
        }}
      />

      {/* Center cap (stationary) */}
      <img
        src="/assets/dj-controls/wheels/jog-wheel-center-cap.svg"
        alt=""
        draggable={false}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "30%",
          height: "30%",
          pointerEvents: "none",
        }}
      />

      {/* Touch feedback overlay */}
      {isDragging && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            background: `radial-gradient(circle, ${accentColor}20 0%, transparent 60%)`,
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
