"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useRef, useState } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};
const PLAYER_FPS = 30;
const PLAYER_DURATION = 180;

function CompatibilityDiagram() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const loopFrame = frame % (6 * fps);

  const progress = interpolate(loopFrame, [0.7 * fps, 4.5 * fps], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.45, 0, 0.55, 1),
  });
  const payloadX = interpolate(
    progress,
    [0, 0.48, 0.52, 1],
    [15, 43, 57, 85],
    clamp,
  );
  const oldOpacity = interpolate(
    loopFrame,
    [2.4 * fps, 2.8 * fps],
    [1, 0],
    clamp,
  );
  const newOpacity = interpolate(
    loopFrame,
    [2.4 * fps, 2.8 * fps],
    [0, 1],
    clamp,
  );
  const edgePulse = interpolate(
    loopFrame,
    [2.15 * fps, 2.5 * fps, 3 * fps, 3.35 * fps],
    [0, 1, 1, 0],
    clamp,
  );

  return (
    <AbsoluteFill
      style={{
        background: "#12110f",
        color: "#f6f1e7",
        fontFamily: "var(--font-sans)",
        padding: "52px 48px 42px",
      }}
    >
      <div className="motion-heading">
        <span>One payload. One automatic change.</span>
        <span>request →</span>
      </div>

      <div className="motion-stage">
        <div className="motion-endpoint motion-endpoint-old">
          <div className="motion-kicker">OLD APP SENDS</div>
          <div className="motion-object">
            <span>name</span>: &quot;Ada Lovelace&quot;
          </div>
        </div>

        <div
          className="motion-edge"
          style={{
            background: `rgba(240, 68, 36, ${0.12 + edgePulse * 0.2})`,
            transform: `translate(-50%, -50%) scale(${1 + edgePulse * 0.035})`,
          }}
        >
          <img aria-hidden alt="" src="/versionless-logo.svg" />
          <strong>VERSIONLESS</strong>
          <span>splits the name</span>
        </div>

        <div className="motion-endpoint motion-endpoint-new">
          <div className="motion-kicker">YOUR API RECEIVES</div>
          <div className="motion-object">
            <span>firstName</span>: &quot;Ada&quot;
            <br />
            <span>lastName</span>: &quot;Lovelace&quot;
          </div>
        </div>

        <div className="motion-track" aria-hidden />
        <div
          className="motion-payload"
          style={{
            left: `${payloadX}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <span style={{ opacity: oldOpacity }}>name</span>
          <span className="motion-payload-new" style={{ opacity: newOpacity }}>
            first + last
          </span>
        </div>
      </div>

      <div className="motion-plain-language">
        Old clients keep their old fields.
        <strong>Your code only sees the new ones.</strong>
      </div>
      <div className="motion-response-note">
        Responses run backward automatically.
      </div>
    </AbsoluteFill>
  );
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(query.matches);

    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return prefersReducedMotion;
}

export function CompatibilityMotion() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const animationFrameRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PlayerRef>(null);

  useEffect(() => {
    const stopAnimation = () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };

    if (prefersReducedMotion) {
      stopAnimation();
      playerRef.current?.seekTo(80);
      return stopAnimation;
    }

    const container = containerRef.current;
    if (!container) {
      return stopAnimation;
    }

    const startAnimation = () => {
      if (animationFrameRef.current !== null) {
        return;
      }

      const firstFrame = playerRef.current?.getCurrentFrame() ?? 0;
      const startedAt = performance.now();
      let previousFrame = firstFrame;

      const tick = (now: number) => {
        const elapsedFrames = Math.floor(
          (now - startedAt) / (1000 / PLAYER_FPS),
        );
        const nextFrame = (firstFrame + elapsedFrames) % PLAYER_DURATION;

        if (nextFrame !== previousFrame) {
          playerRef.current?.seekTo(nextFrame);
          previousFrame = nextFrame;
        }

        animationFrameRef.current = requestAnimationFrame(tick);
      };

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    const setPlayback = (visible: boolean) => {
      if (visible && document.visibilityState === "visible") {
        startAnimation();
      } else {
        stopAnimation();
      }
    };

    const isOnScreen = () => {
      const bounds = container.getBoundingClientRect();
      return bounds.bottom > 0 && bounds.top < window.innerHeight;
    };

    const observer = new IntersectionObserver(
      ([entry]) => setPlayback(entry?.isIntersecting ?? false),
      { threshold: 0.2 },
    );
    const startFrame = requestAnimationFrame(() => setPlayback(isOnScreen()));
    const handleVisibilityChange = () => setPlayback(isOnScreen());

    observer.observe(container);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelAnimationFrame(startFrame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopAnimation();
    };
  }, [prefersReducedMotion]);

  return (
    <div className="compatibility-player" ref={containerRef}>
      <Player
        acknowledgeRemotionLicense
        clickToPlay={false}
        component={CompatibilityDiagram}
        compositionHeight={500}
        compositionWidth={1200}
        controls={false}
        durationInFrames={PLAYER_DURATION}
        fps={PLAYER_FPS}
        initialFrame={prefersReducedMotion ? 80 : 0}
        loop
        ref={playerRef}
        style={{ aspectRatio: "1200 / 500", width: "100%" }}
      />
    </div>
  );
}
