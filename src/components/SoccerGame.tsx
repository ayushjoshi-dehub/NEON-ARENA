import React, { useEffect, useRef, useState } from "react";
import { SoccerBall, SoccerPlayerState } from "../types";
import { RotateCcw, Volume2, VolumeX, LogOut, Award } from "lucide-react";

interface SoccerGameProps {
  isOnline: boolean;
  isHost: boolean;
  socket: WebSocket | null;
  p1Name: string;
  p2Name: string;
  onQuit: () => void;
}

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 450;
const GOAL_TOP = 150;
const GOAL_BOTTOM = 300;
const PLAYER_RADIUS = 25;
const BALL_RADIUS = 12;

export default function SoccerGame({ isOnline, isHost, socket, p1Name, p2Name, onQuit }: SoccerGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // sound state
  const [muted, setMuted] = useState(true);

  // general game state
  const [p1Score, setP1Score] = useState(0);
  const [p2Score, setP2Score] = useState(0);
  const [winner, setWinner] = useState<string | null>(null);
  const [gameState, setGameState] = useState<"countdown" | "playing" | "goal" | "finished">("countdown");
  const [countdown, setCountdown] = useState(3);
  const [goalScorer, setGoalScorer] = useState<string | null>(null);

  // References for live physics simulation
  const p1Ref = useRef<SoccerPlayerState>({
    x: 150,
    y: CANVAS_HEIGHT / 2,
    radius: PLAYER_RADIUS,
    score: 0,
    speed: 5.5,
  });

  const p2Ref = useRef<SoccerPlayerState>({
    x: CANVAS_WIDTH - 150,
    y: CANVAS_HEIGHT / 2,
    radius: PLAYER_RADIUS,
    score: 0,
    speed: 5.5,
  });

  const ballRef = useRef<SoccerBall>({
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT / 2,
    vx: 0,
    vy: 0,
    radius: BALL_RADIUS,
  });

  const particlesRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; color: string; size: number; alpha: number }>>([]);
  const keysRef = useRef<Record<string, boolean>>({});

  // Dash references
  const p1DashTimerRef = useRef(0);
  const p1DashCooldownRef = useRef(0);
  const p1DashDirRef = useRef({ x: 0, y: 0 });

  const p2DashTimerRef = useRef(0);
  const p2DashCooldownRef = useRef(0);
  const p2DashDirRef = useRef({ x: 0, y: 0 });

  // Audio synthethizer helper
  const playSound = (type: "kick" | "wall" | "goal" | "start" | "win") => {
    if (muted) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === "kick") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(180, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      } else if (type === "wall") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(100, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.08);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      } else if (type === "goal") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(200, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.4);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      } else if (type === "start") {
        osc.type = "square";
        osc.frequency.setValueAtTime(330, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      } else if (type === "win") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(293.7, ctx.currentTime); // D
        osc.frequency.setValueAtTime(349.2, ctx.currentTime + 0.1); // F
        osc.frequency.setValueAtTime(440.0, ctx.currentTime + 0.2); // A
        osc.frequency.setValueAtTime(587.3, ctx.currentTime + 0.3); // D2
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.6);
        osc.start();
        osc.stop(ctx.currentTime + 0.6);
      }
    } catch (e) {
      // Audio fails gracefully
    }
  };

  // Sparkle particles generator
  const spawnParticles = (x: number, y: number, color: string, count = 10) => {
    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6,
        color,
        size: Math.random() * 4 + 2,
        alpha: 1,
      });
    }
  };

  // Setup countdown
  useEffect(() => {
    let cdInterval: NodeJS.Timeout;
    if (gameState === "countdown") {
      cdInterval = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(cdInterval);
            setGameState("playing");
            playSound("start");
            return 0;
          }
          playSound("start");
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(cdInterval);
  }, [gameState]);

  // Online network message sync handler
  useEffect(() => {
    if (!isOnline || !socket) return;

    const handleMessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "game:sync") {
          const payload = msg.payload;

          if (payload.action === "p2:input") {
            // Received P2 position from Guest (if we are Host)
            if (isHost) {
              p2Ref.current.x = payload.x;
              p2Ref.current.y = payload.y;
            }
          } else if (payload.action === "host:state") {
            // Received state authority from Host (if we are Guest)
            if (!isHost) {
              p1Ref.current.x = payload.p1.x;
              p1Ref.current.y = payload.p1.y;
              p2Ref.current.x = payload.p2.x;
              p2Ref.current.y = payload.p2.y;
              
              ballRef.current.x = payload.ball.x;
              ballRef.current.y = payload.ball.y;
              ballRef.current.vx = payload.ball.vx;
              ballRef.current.vy = payload.ball.vy;

              setP1Score(payload.scores.p1);
              setP2Score(payload.scores.p2);

              if (payload.event === "goal") {
                setGoalScorer(payload.scorer);
                setGameState("goal");
                playSound("goal");
                spawnParticles(payload.ball.x, payload.ball.y, "#eab308", 25);
              } else if (payload.event === "resume") {
                setCountdown(2);
                setGameState("countdown");
              } else if (payload.event === "finished") {
                setWinner(payload.winner);
                setGameState("finished");
                playSound("win");
              }
            }
          } else if (payload.action === "reset") {
            resetLocalState();
          }
        }
      } catch (err) {
        console.error("Error reading network sync message:", err);
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => {
      socket.removeEventListener("message", handleMessage);
    };
  }, [isOnline, isHost, socket]);

  // Track key actions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = true;
      keysRef.current[e.key] = true;

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Enter"].includes(e.key)) {
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = false;
      keysRef.current[e.key] = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const resetLocalState = () => {
    p1Ref.current = { x: 150, y: CANVAS_HEIGHT / 2, radius: PLAYER_RADIUS, score: 0, speed: 5.5 };
    p2Ref.current = { x: CANVAS_WIDTH - 150, y: CANVAS_HEIGHT / 2, radius: PLAYER_RADIUS, score: 0, speed: 5.5 };
    ballRef.current = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2, vx: 0, vy: 0, radius: BALL_RADIUS };
    setP1Score(0);
    setP2Score(0);
    setCountdown(3);
    setGameState("countdown");
    setWinner(null);
    setGoalScorer(null);
    particlesRef.current = [];
  };

  const handleRestart = () => {
    resetLocalState();
    if (isOnline && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "game:sync",
          payload: { action: "reset" },
        })
      );
    }
  };

  const handleGoalScored = (scorer: "P1" | "P2") => {
    playSound("goal");
    setGameState("goal");

    if (scorer === "P1") {
      setGoalScorer(p1Name);
      const newScore = p1Score + 1;
      setP1Score(newScore);
      p1Ref.current.score = newScore;
      spawnParticles(CANVAS_WIDTH - 20, CANVAS_HEIGHT / 2, "#06b6d4", 30);
    } else {
      setGoalScorer(p2Name);
      const newScore = p2Score + 1;
      setP2Score(newScore);
      p2Ref.current.score = newScore;
      spawnParticles(20, CANVAS_HEIGHT / 2, "#c084fc", 30);
    }

    // Check match complete (first to 5)
    const targetScore = scorer === "P1" ? p1Score + 1 : p2Score + 1;
    if (targetScore >= 5) {
      setTimeout(() => {
        setGameState("finished");
        const finalWinner = targetScore === p1Score + 1 ? p1Name : p2Name;
        setWinner(finalWinner);
        playSound("win");
        
        if (isOnline && isHost && socket && socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: "game:sync",
              payload: {
                action: "host:state",
                p1: p1Ref.current,
                p2: p2Ref.current,
                ball: ballRef.current,
                scores: { p1: p1Ref.current.score, p2: p2Ref.current.score },
                event: "finished",
                winner: finalWinner,
              },
            })
          );
        }
      }, 1500);
      return;
    }

    // Reset ball and players after goal
    setTimeout(() => {
      p1Ref.current.x = 150;
      p1Ref.current.y = CANVAS_HEIGHT / 2;
      p2Ref.current.x = CANVAS_WIDTH - 150;
      p2Ref.current.y = CANVAS_HEIGHT / 2;
      ballRef.current = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2, vx: 0, vy: 0, radius: BALL_RADIUS };
      setCountdown(2);
      setGameState("countdown");

      if (isOnline && isHost && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "game:sync",
            payload: {
              action: "host:state",
              p1: p1Ref.current,
              p2: p2Ref.current,
              ball: ballRef.current,
              scores: { p1: p1Ref.current.score, p2: p2Ref.current.score },
              event: "resume",
            },
          })
        );
      }
    }, 2000);

    // Sync goal state from Host
    if (isOnline && isHost && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "game:sync",
          payload: {
            action: "host:state",
            p1: p1Ref.current,
            p2: p2Ref.current,
            ball: ballRef.current,
            scores: { p1: p1Ref.current.score, p2: p2Ref.current.score },
            event: "goal",
            scorer: scorer === "P1" ? p1Name : p2Name,
          },
        })
      );
    }
  };

  // Main game logic loop
  useEffect(() => {
    let animId: number;

    const gameLoop = () => {
      // 1. INPUT HANDLING & PLAYER POSITION UPDATE
      const p1 = p1Ref.current;
      const p2 = p2Ref.current;
      const ball = ballRef.current;

      // Decrement dash cooldowns & active timers
      if (p1DashCooldownRef.current > 0) p1DashCooldownRef.current--;
      if (p2DashCooldownRef.current > 0) p2DashCooldownRef.current--;

      // Local or Host: Update P1 (WASD + Space to Dash)
      if (!isOnline || isHost) {
        let p1dx = 0;
        let p1dy = 0;
        if (keysRef.current["w"] || keysRef.current["W"]) p1dy = -1;
        if (keysRef.current["s"] || keysRef.current["S"]) p1dy = 1;
        if (keysRef.current["a"] || keysRef.current["A"]) p1dx = -1;
        if (keysRef.current["d"] || keysRef.current["D"]) p1dx = 1;

        // Trigger Dash on Space
        if (keysRef.current[" "] && p1DashCooldownRef.current === 0 && (p1dx !== 0 || p1dy !== 0)) {
          const len = Math.hypot(p1dx, p1dy);
          p1DashDirRef.current = { x: p1dx / len, y: p1dy / len };
          p1DashTimerRef.current = 10; // active for 10 frames
          p1DashCooldownRef.current = 90; // 1.5s cooldown
          playSound("kick");
          spawnParticles(p1.x, p1.y, "#06b6d4", 15);
        }

        // Apply movement
        if (p1DashTimerRef.current > 0) {
          p1DashTimerRef.current--;
          p1.x += p1DashDirRef.current.x * 12;
          p1.y += p1DashDirRef.current.y * 12;
          if (Math.random() < 0.5) {
            spawnParticles(p1.x, p1.y, "#06b6d4", 2);
          }
        } else {
          p1.x += p1dx * p1.speed;
          p1.y += p1dy * p1.speed;
        }

        // Boundaries check P1
        p1.x = Math.max(p1.radius, Math.min(CANVAS_WIDTH - p1.radius, p1.x));
        p1.y = Math.max(p1.radius, Math.min(CANVAS_HEIGHT - p1.radius, p1.y));
      }

      // Local or Guest: Update P2 (Arrows + Enter to Dash)
      if (!isOnline || !isHost) {
        let p2dx = 0;
        let p2dy = 0;
        if (keysRef.current["arrowup"]) p2dy = -1;
        if (keysRef.current["arrowdown"]) p2dy = 1;
        if (keysRef.current["arrowleft"]) p2dx = -1;
        if (keysRef.current["arrowright"]) p2dx = 1;

        // Trigger Dash on Enter
        if (keysRef.current["enter"] && p2DashCooldownRef.current === 0 && (p2dx !== 0 || p2dy !== 0)) {
          const len = Math.hypot(p2dx, p2dy);
          p2DashDirRef.current = { x: p2dx / len, y: p2dy / len };
          p2DashTimerRef.current = 10;
          p2DashCooldownRef.current = 90;
          playSound("kick");
          spawnParticles(p2.x, p2.y, "#c084fc", 15);
        }

        // Apply movement
        if (p2DashTimerRef.current > 0) {
          p2DashTimerRef.current--;
          p2.x += p2DashDirRef.current.x * 12;
          p2.y += p2DashDirRef.current.y * 12;
          if (Math.random() < 0.5) {
            spawnParticles(p2.x, p2.y, "#c084fc", 2);
          }
        } else {
          p2.x += p2dx * p2.speed;
          p2.y += p2dy * p2.speed;
        }

          p2.x = Math.max(p2.radius, Math.min(CANVAS_WIDTH - p2.radius, p2.x));
          p2.y = Math.max(p2.radius, Math.min(CANVAS_HEIGHT - p2.radius, p2.y));

        // Guest sends their coordinates to Host
        if (isOnline && !isHost && socket && socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: "game:sync",
              payload: {
                action: "p2:input",
                x: p2.x,
                y: p2.y,
              },
            })
          );
        }
      }

      // 2. BALL PHYSICS & COLLISIONS (HOST OR LOCAL ONLY)
      if (gameState === "playing" && (!isOnline || isHost)) {
        // Friction / Air damping
        ball.vx *= 0.985;
        ball.vy *= 0.985;

        // Apply friction threshold
        if (Math.abs(ball.vx) < 0.1) ball.vx = 0;
        if (Math.abs(ball.vy) < 0.1) ball.vy = 0;

        // Move ball
        ball.x += ball.vx;
        ball.y += ball.vy;

        // Wall collisions
        // Top and Bottom walls
        if (ball.y <= ball.radius) {
          ball.y = ball.radius;
          ball.vy = -ball.vy * 0.85;
          playSound("wall");
          spawnParticles(ball.x, ball.y, "#ffffff", 4);
        } else if (ball.y >= CANVAS_HEIGHT - ball.radius) {
          ball.y = CANVAS_HEIGHT - ball.radius;
          ball.vy = -ball.vy * 0.85;
          playSound("wall");
          spawnParticles(ball.x, ball.y, "#ffffff", 4);
        }

        // Left and Right walls (Excluding goal range)
        const isGoalHeight = ball.y >= GOAL_TOP && ball.y <= GOAL_BOTTOM;

        if (!isGoalHeight) {
          // Normal bounce-off left/right wall
          if (ball.x <= ball.radius) {
            ball.x = ball.radius;
            ball.vx = -ball.vx * 0.85;
            playSound("wall");
            spawnParticles(ball.x, ball.y, "#ffffff", 4);
          } else if (ball.x >= CANVAS_WIDTH - ball.radius) {
            ball.x = CANVAS_WIDTH - ball.radius;
            ball.vx = -ball.vx * 0.85;
            playSound("wall");
            spawnParticles(ball.x, ball.y, "#ffffff", 4);
          }
        } else {
          // Goal detection
          if (ball.x <= -ball.radius) {
            // Ball inside P1 goal -> Goal for P2!
            handleGoalScored("P2");
          } else if (ball.x >= CANVAS_WIDTH + ball.radius) {
            // Ball inside P2 goal -> Goal for P1!
            handleGoalScored("P1");
          }
        }

        // 3. CIRCULAR COLLISION DETECTION
        // Player 1 with Ball
        let distP1 = Math.hypot(ball.x - p1.x, ball.y - p1.y);
        let minDistP1 = p1.radius + ball.radius;
        if (distP1 < minDistP1) {
          // Push ball away from Player 1
          let angle = Math.atan2(ball.y - p1.y, ball.x - p1.x);
          // Overlap correction
          let overlap = minDistP1 - distP1;
          ball.x += Math.cos(angle) * overlap;
          ball.y += Math.sin(angle) * overlap;

          // Apply velocity transfer based on active dash
          const isP1Dashing = p1DashTimerRef.current > 0;
          const hitPower = isP1Dashing ? 12 : Math.max(Math.hypot(ball.vx, ball.vy) * 0.75 + 2.2, 5.8);

          ball.vx = Math.cos(angle) * hitPower + (isP1Dashing ? p1DashDirRef.current.x * 2.5 : 0);
          ball.vy = Math.sin(angle) * hitPower + (isP1Dashing ? p1DashDirRef.current.y * 2.5 : 0);

          playSound("kick");
          spawnParticles(ball.x, ball.y, "#06b6d4", isP1Dashing ? 22 : 10);
        }

        // Player 2 with Ball
        let distP2 = Math.hypot(ball.x - p2.x, ball.y - p2.y);
        let minDistP2 = p2.radius + ball.radius;
        if (distP2 < minDistP2) {
          // Push ball away from Player 2
          let angle = Math.atan2(ball.y - p2.y, ball.x - p2.x);
          let overlap = minDistP2 - distP2;
          ball.x += Math.cos(angle) * overlap;
          ball.y += Math.sin(angle) * overlap;

          // Apply velocity transfer based on active dash
          const isP2Dashing = p2DashTimerRef.current > 0;
          const hitPower = isP2Dashing ? 12 : Math.max(Math.hypot(ball.vx, ball.vy) * 0.75 + 2.2, 5.8);

          ball.vx = Math.cos(angle) * hitPower + (isP2Dashing ? p2DashDirRef.current.x * 2.5 : 0);
          ball.vy = Math.sin(angle) * hitPower + (isP2Dashing ? p2DashDirRef.current.y * 2.5 : 0);

          playSound("kick");
          spawnParticles(ball.x, ball.y, "#c084fc", isP2Dashing ? 22 : 10);
        }

        // Player-to-Player collision (prevent overlapping circular avatars)
        let distPlayers = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        let minPlayersDist = p1.radius + p2.radius;
        if (distPlayers < minPlayersDist) {
          let angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          let overlap = minPlayersDist - distPlayers;
          // Split push equally
          p1.x -= Math.cos(angle) * (overlap / 2);
          p1.y -= Math.sin(angle) * (overlap / 2);
          p2.x += Math.cos(angle) * (overlap / 2);
          p2.y += Math.sin(angle) * (overlap / 2);
          playSound("wall");
          spawnParticles((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, "#e2e8f0", 6);
        }

        // Sync state to Guest
        if (isOnline && isHost && socket && socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: "game:sync",
              payload: {
                action: "host:state",
                p1: p1,
                p2: p2,
                ball: ball,
                scores: { p1: p1Score, p2: p2Score },
                event: null,
              },
            })
          );
        }
      }

      // 4. ANIMATION PARTICLES PHYSICS
      particlesRef.current = particlesRef.current
        .map((p) => ({
          ...p,
          x: p.x + p.vx,
          y: p.y + p.vy,
          alpha: p.alpha - 0.03,
        }))
        .filter((p) => p.alpha > 0);

      render();
      animId = requestAnimationFrame(gameLoop);
    };

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Pitch background (gorgeous retro soccer grass green!)
      ctx.fillStyle = "#14532d"; // dark green 900
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // White Pitch lines
      ctx.strokeStyle = "#22c55e"; // light green 500
      ctx.lineWidth = 3;

      // Outer boundary lines
      ctx.strokeRect(5, 5, CANVAS_WIDTH - 10, CANVAS_HEIGHT - 10);

      // Center pitch line
      ctx.beginPath();
      ctx.moveTo(CANVAS_WIDTH / 2, 5);
      ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 5);
      ctx.stroke();

      // Center Circle
      ctx.beginPath();
      ctx.arc(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 70, 0, Math.PI * 2);
      ctx.stroke();

      // Center spot
      ctx.fillStyle = "#22c55e";
      ctx.beginPath();
      ctx.arc(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 5, 0, Math.PI * 2);
      ctx.fill();

      // Goal Nets drawings
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4;
      // Left Goal Net Outline
      ctx.strokeRect(-5, GOAL_TOP, 10, GOAL_BOTTOM - GOAL_TOP);
      // Right Goal Net Outline
      ctx.strokeRect(CANVAS_WIDTH - 5, GOAL_TOP, 10, GOAL_BOTTOM - GOAL_TOP);

      // Drawing goals post lights (neon glow)
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#3b82f6";
      ctx.strokeStyle = "#60a5fa";
      ctx.lineWidth = 3;
      // Left post
      ctx.beginPath();
      ctx.arc(10, GOAL_TOP, 6, 0, Math.PI * 2);
      ctx.arc(10, GOAL_BOTTOM, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#60a5fa";
      ctx.fill();
      ctx.stroke();

      // Right post
      ctx.shadowColor = "#a855f7";
      ctx.strokeStyle = "#c084fc";
      ctx.beginPath();
      ctx.arc(CANVAS_WIDTH - 10, GOAL_TOP, 6, 0, Math.PI * 2);
      ctx.arc(CANVAS_WIDTH - 10, GOAL_BOTTOM, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#c084fc";
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0; // Reset shadow

      // 4. DRAW BALL
      const ball = ballRef.current;
      ctx.save();
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#f8fafc"; // bright white
      ctx.strokeStyle = "#020617";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Draw standard soccer pentagon pattern lines on ball
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ball.x, ball.y);
      ctx.lineTo(ball.x - 6, ball.y - 6);
      ctx.moveTo(ball.x, ball.y);
      ctx.lineTo(ball.x + 8, ball.y - 2);
      ctx.moveTo(ball.x, ball.y);
      ctx.lineTo(ball.x - 2, ball.y + 8);
      ctx.stroke();
      ctx.restore();

      // 5. DRAW PLAYERS
      const p1 = p1Ref.current;
      const p2 = p2Ref.current;

      // Draw Player 1 (Cyan avatar)
      ctx.save();
      ctx.shadowColor = "#06b6d4";
      ctx.shadowBlur = 15;
      ctx.fillStyle = "#0891b2";
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, p1.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // P1 center text or jersey number
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 14px 'JetBrains Mono'";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("P1", p1.x, p1.y);
      ctx.restore();

      // Draw Player 2 (Purple avatar)
      ctx.save();
      ctx.shadowColor = "#c084fc";
      ctx.shadowBlur = 15;
      ctx.fillStyle = "#9333ea";
      ctx.strokeStyle = "#d8b4fe";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p2.x, p2.y, p2.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // P2 center text or jersey number
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 14px 'JetBrains Mono'";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("P2", p2.x, p2.y);
      ctx.restore();

      // Draw spark particles
      particlesRef.current.forEach((p) => {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    };

    animId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animId);
  }, [gameState, p1Score, p2Score, isOnline, isHost, socket, muted]);

  return (
    <div className="flex flex-col items-center bg-black rounded-2xl overflow-hidden shadow-2xl border border-zinc-800 w-full max-w-4xl p-4 md:p-6" id="soccer-game-arena">
      {/* HUD Header */}
      <div className="flex flex-col md:flex-row md:justify-between items-center w-full mb-4 gap-2 pb-3 border-b border-zinc-800">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-cyan-400 tracking-wider">
            ARCADE FOOTBALL
          </h2>
          <p className="text-xs text-zinc-400 font-mono">
            🥅 SCORE 5 GOALS TO WIN THE CHAMPIONSHIP
          </p>
        </div>

        {/* Live Score board */}
        <div className="flex items-center gap-6 bg-zinc-950 px-4 py-2 rounded-lg border border-zinc-800">
          <div className="text-center">
            <span className="block text-xs font-semibold text-cyan-400">{p1Name}</span>
            <span className="font-mono text-lg font-bold text-white">{p1Score}</span>
          </div>
          <div className="text-zinc-700 text-lg font-bold font-mono">:</div>
          <div className="text-center">
            <span className="block text-xs font-semibold text-purple-400">{p2Name}</span>
            <span className="font-mono text-lg font-bold text-white">{p2Score}</span>
          </div>
        </div>

        {/* Audio / Options */}
        <div className="flex items-center gap-2">
          <button
            id="soccer-mute"
            onClick={() => setMuted(!muted)}
            className="p-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg transition"
          >
            {muted ? <VolumeX className="w-5 h-5 text-red-500" /> : <Volume2 className="w-5 h-5 text-green-500" />}
          </button>
          <button
            id="soccer-quit"
            onClick={onQuit}
            className="flex items-center gap-1.5 px-3 py-2 bg-red-950/40 hover:bg-red-950 text-red-400 border border-red-900 rounded-lg text-sm transition font-medium"
          >
            <LogOut className="w-4 h-4" />
            Quit
          </button>
        </div>
      </div>

      {/* Pitch Canvas Screen */}
      <div className="relative w-full overflow-hidden bg-zinc-950 border border-zinc-800 rounded-xl">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="w-full h-auto block aspect-[16/9]"
        />

        {/* COUNTDOWN */}
        {gameState === "countdown" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm z-10">
            <div className="text-center">
              <span className="text-6xl font-black font-mono text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-yellow-400 animate-pulse">
                {countdown > 0 ? countdown : "PLAY!"}
              </span>
              <p className="text-zinc-400 tracking-wider uppercase mt-4 text-xs font-semibold">
                Kickoff Commencing...
              </p>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-8 max-w-lg bg-zinc-900/80 p-4 rounded-xl border border-zinc-800">
              <div className="text-center border-r border-zinc-800 pr-4">
                <span className="block text-cyan-400 font-bold mb-1">{p1Name} Controls</span>
                <div className="flex justify-center gap-0.5 mb-1">
                  <span className="inline-block bg-zinc-950 border border-zinc-800 font-mono text-xs text-white px-2 py-0.5 rounded mx-0.5">W</span>
                  <span className="inline-block bg-zinc-950 border border-zinc-800 font-mono text-xs text-white px-2 py-0.5 rounded mx-0.5">A</span>
                  <span className="inline-block bg-zinc-950 border border-zinc-800 font-mono text-xs text-white px-2 py-0.5 rounded mx-0.5">S</span>
                  <span className="inline-block bg-zinc-950 border border-zinc-800 font-mono text-xs text-white px-2 py-0.5 rounded mx-0.5">D</span>
                </div>
                <div className="mt-2">
                  <span className="inline-block bg-cyan-950/60 border border-cyan-800 font-mono text-xs text-cyan-400 px-3 py-0.5 rounded">SPACE</span>
                  <p className="text-[10px] text-cyan-500 mt-0.5 font-semibold">Dash / Slide Tackle</p>
                </div>
              </div>
              <div className="text-center pl-4">
                <span className="block text-purple-400 font-bold mb-1">{p2Name} Controls</span>
                <div className="flex justify-center gap-0.5 mb-1">
                  <span className="inline-block bg-zinc-950 border border-zinc-800 font-mono text-xs text-white px-2 py-0.5 rounded mx-0.5">▲</span>
                  <span className="inline-block bg-zinc-950 border border-zinc-800 font-mono text-xs text-white px-2 py-0.5 rounded mx-0.5">◀</span>
                  <span className="inline-block bg-zinc-950 border border-zinc-800 font-mono text-xs text-white px-2 py-0.5 rounded mx-0.5">▼</span>
                  <span className="inline-block bg-zinc-950 border border-zinc-800 font-mono text-xs text-white px-2 py-0.5 rounded mx-0.5">▶</span>
                </div>
                <div className="mt-2">
                  <span className="inline-block bg-purple-950/60 border border-purple-800 font-mono text-xs text-purple-400 px-3 py-0.5 rounded">ENTER</span>
                  <p className="text-[10px] text-purple-500 mt-0.5 font-semibold">Dash / Slide Tackle</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* GOAL VIEW OVERLAY */}
        {gameState === "goal" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/75 backdrop-blur-xs z-10 animate-fade-in">
            <h1 className="text-5xl md:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 tracking-widest animate-bounce">
              GOOOOOAL!!!
            </h1>
            <p className="text-white text-xl font-bold mt-4">
              ⚽ {goalScorer} scored!
            </p>
          </div>
        )}

        {/* MATCH FINISHED OVERLAY */}
        {gameState === "finished" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md z-10">
            <Award className="w-16 h-16 text-yellow-400 animate-bounce mb-3" />
            <h3 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-cyan-400 tracking-wider">
              MATCH COMPLETED!
            </h3>
            <p className="text-white text-2xl font-bold mt-2">
              🏆 {winner} Wins the Cup!
            </p>

            <div className="flex gap-8 my-6 bg-zinc-950/80 p-5 rounded-xl border border-zinc-800 min-w-[280px] justify-center items-center">
              <div className="text-center">
                <span className="text-xs text-cyan-400 block mb-1">{p1Name}</span>
                <span className="text-3xl font-mono font-bold text-white">{p1Score}</span>
              </div>
              <div className="text-zinc-600 font-mono font-bold text-lg">vs</div>
              <div className="text-center">
                <span className="text-xs text-purple-400 block mb-1">{p2Name}</span>
                <span className="text-3xl font-mono font-bold text-white">{p2Score}</span>
              </div>
            </div>

            <div className="flex gap-4">
              {(!isOnline || isHost) && (
                <button
                  id="soccer-restart-btn"
                  onClick={handleRestart}
                  className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-6 py-3 rounded-lg font-bold tracking-wider transition hover:scale-105"
                >
                  <RotateCcw className="w-5 h-5" />
                  PLAY AGAIN
                </button>
              )}
              {isOnline && !isHost && (
                <div className="text-sm text-zinc-400 italic bg-zinc-900 border border-zinc-800 px-4 py-3 rounded-lg">
                  Waiting for host to restart game...
                </div>
              )}
              <button
                id="soccer-exit-btn"
                onClick={onQuit}
                className="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-3 rounded-lg font-bold tracking-wider transition"
              >
                BACK TO LOBBY
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 w-full text-center text-xs text-zinc-500 font-sans">
        ⭐ Control physics: Avatars have mass! Smash into the ball with speed to shoot rocket goals. Play defensively to block the goal posts!
      </div>
    </div>
  );
}
