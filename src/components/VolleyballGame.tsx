import React, { useEffect, useRef, useState } from "react";
import { RotateCcw, Volume2, VolumeX, LogOut, Award } from "lucide-react";

interface VolleyballGameProps {
  isOnline: boolean;
  isHost: boolean;
  socket: WebSocket | null;
  p1Name: string;
  p2Name: string;
  onQuit: () => void;
}

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 450;
const FLOOR_Y = 390;
const NET_X = CANVAS_WIDTH / 2;
const NET_TOP_Y = 280;
const NET_WIDTH = 8;
const PLAYER_RADIUS = 40;
const BALL_RADIUS = 12;
const GRAVITY = 0.45;

interface VolleyPlayer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  isJumping: boolean;
  score: number;
  radius: number;
}

interface VolleyBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  isSpiked: boolean;
}

export default function VolleyballGame({ isOnline, isHost, socket, p1Name, p2Name, onQuit }: VolleyballGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sound effects state
  const [muted, setMuted] = useState(true);

  // General game state
  const [p1Score, setP1Score] = useState(0);
  const [p2Score, setP2Score] = useState(0);
  const [winner, setWinner] = useState<string | null>(null);
  const [gameState, setGameState] = useState<"countdown" | "playing" | "point" | "finished">("countdown");
  const [countdown, setCountdown] = useState(3);
  const [pointScorer, setPointScorer] = useState<string | null>(null);

  // References for live simulation
  const p1Ref = useRef<VolleyPlayer>({
    x: 180,
    y: FLOOR_Y,
    vx: 0,
    vy: 0,
    isJumping: false,
    score: 0,
    radius: PLAYER_RADIUS,
  });

  const p2Ref = useRef<VolleyPlayer>({
    x: CANVAS_WIDTH - 180,
    y: FLOOR_Y,
    vx: 0,
    vy: 0,
    isJumping: false,
    score: 0,
    radius: PLAYER_RADIUS,
  });

  const ballRef = useRef<VolleyBall>({
    x: 200,
    y: 150,
    vx: 0,
    vy: 1,
    radius: BALL_RADIUS,
    isSpiked: false,
  });

  const particlesRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; color: string; size: number; alpha: number }>>([]);
  const floatTextsRef = useRef<Array<{ x: number; y: number; text: string; color: string; timer: number }>>([]);
  const keysRef = useRef<Record<string, boolean>>({});

  // Audio synthesizer helper
  const playSound = (type: "bounce" | "spike" | "score" | "start" | "win") => {
    if (muted) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === "bounce") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(240, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      } else if (type === "spike") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } else if (type === "score") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(150, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(350, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } else if (type === "start") {
        osc.type = "square";
        osc.frequency.setValueAtTime(330, ctx.currentTime);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      } else if (type === "win") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        osc.frequency.setValueAtTime(277.18, ctx.currentTime + 0.12);
        osc.frequency.setValueAtTime(329.63, ctx.currentTime + 0.24);
        osc.frequency.setValueAtTime(440, ctx.currentTime + 0.36);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.7);
        osc.start();
        osc.stop(ctx.currentTime + 0.7);
      }
    } catch (e) {
      // Audio fails gracefully
    }
  };

  // Particle sparkle generator
  const spawnParticles = (x: number, y: number, color: string, count = 12, isSpike = false) => {
    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8 - (isSpike ? 2 : 0),
        color,
        size: Math.random() * 4 + 2,
        alpha: 1,
      });
    }
  };

  const addFloatText = (x: number, y: number, text: string, color: string) => {
    floatTextsRef.current.push({ x, y, text, color, timer: 45 });
  };

  // Setup countdown timer
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

  // Handle peer WebSockets sync
  useEffect(() => {
    if (!isOnline || !socket) return;

    const handleMessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "game:sync") {
          const payload = msg.payload;

          if (payload.action === "p2:input") {
            if (isHost) {
              p2Ref.current.x = payload.x;
              p2Ref.current.y = payload.y;
              p2Ref.current.vx = payload.vx;
              p2Ref.current.vy = payload.vy;
              p2Ref.current.isJumping = payload.isJumping;
            }
          } else if (payload.action === "host:state") {
            if (!isHost) {
              // Copy peer states
              p1Ref.current.x = payload.p1.x;
              p1Ref.current.y = payload.p1.y;
              p1Ref.current.isJumping = payload.p1.isJumping;
              
              p2Ref.current.x = payload.p2.x;
              p2Ref.current.y = payload.p2.y;
              p2Ref.current.isJumping = payload.p2.isJumping;

              ballRef.current.x = payload.ball.x;
              ballRef.current.y = payload.ball.y;
              ballRef.current.vx = payload.ball.vx;
              ballRef.current.vy = payload.ball.vy;
              ballRef.current.isSpiked = payload.ball.isSpiked;

              setP1Score(payload.scores.p1);
              setP2Score(payload.scores.p2);

              if (payload.event === "point") {
                setPointScorer(payload.scorerName);
                setGameState("point");
                playSound("score");
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
        console.error("Error processing websocket volley message:", err);
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => {
      socket.removeEventListener("message", handleMessage);
    };
  }, [isOnline, isHost, socket]);

  // Capture input keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = true;
      keysRef.current[e.key] = true;

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
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
    p1Ref.current = { x: 180, y: FLOOR_Y, vx: 0, vy: 0, isJumping: false, score: 0, radius: PLAYER_RADIUS };
    p2Ref.current = { x: CANVAS_WIDTH - 180, y: FLOOR_Y, vx: 0, vy: 0, isJumping: false, score: 0, radius: PLAYER_RADIUS };
    ballRef.current = { x: 200, y: 150, vx: 0, vy: 1, radius: BALL_RADIUS, isSpiked: false };
    setP1Score(0);
    setP2Score(0);
    setCountdown(3);
    setGameState("countdown");
    setWinner(null);
    setPointScorer(null);
    particlesRef.current = [];
    floatTextsRef.current = [];
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

  const handlePointScored = (side: "left" | "right") => {
    playSound("score");
    setGameState("point");

    let scorerName = "";
    if (side === "left") {
      // Ball landed on left side -> Player 2 scores
      scorerName = p2Name;
      const newScore = p2Score + 1;
      setP2Score(newScore);
      p2Ref.current.score = newScore;
      spawnParticles(ballRef.current.x, FLOOR_Y, "#c084fc", 35);
      addFloatText(ballRef.current.x, FLOOR_Y - 40, `Point to ${p2Name}!`, "#c084fc");
    } else {
      // Ball landed on right side -> Player 1 scores
      scorerName = p1Name;
      const newScore = p1Score + 1;
      setP1Score(newScore);
      p1Ref.current.score = newScore;
      spawnParticles(ballRef.current.x, FLOOR_Y, "#06b6d4", 35);
      addFloatText(ballRef.current.x, FLOOR_Y - 40, `Point to ${p1Name}!`, "#06b6d4");
    }

    const checkWinScore = side === "left" ? p2Score + 1 : p1Score + 1;
    if (checkWinScore >= 7) {
      setTimeout(() => {
        setGameState("finished");
        const finalWinner = checkWinScore === p1Score + 1 ? p1Name : p2Name;
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
                scores: { p1: p1Score, p2: p2Score },
                event: "finished",
                winner: finalWinner,
              },
            })
          );
        }
      }, 1000);
    } else {
      setTimeout(() => {
        // Reset ball position
        ballRef.current = {
          x: side === "left" ? 200 : 600,
          y: 100,
          vx: 0,
          vy: 1.5,
          radius: BALL_RADIUS,
          isSpiked: false,
        };
        // Reset player positions on floor
        p1Ref.current.x = 180;
        p1Ref.current.y = FLOOR_Y;
        p1Ref.current.vx = 0;
        p1Ref.current.vy = 0;
        p1Ref.current.isJumping = false;

        p2Ref.current.x = CANVAS_WIDTH - 180;
        p2Ref.current.y = FLOOR_Y;
        p2Ref.current.vx = 0;
        p2Ref.current.vy = 0;
        p2Ref.current.isJumping = false;

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
      }, 1800);
    }
  };

  // Main animation frame loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animFrameId: number;

    const gameLoop = () => {
      // Clear with elegant retro grid trace
      ctx.fillStyle = "#09090b";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Draw horizontal background scanner lines
      ctx.strokeStyle = "#18181b";
      ctx.lineWidth = 1;
      for (let y = 0; y < CANVAS_HEIGHT; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_WIDTH, y);
        ctx.stroke();
      }
      for (let x = 0; x < CANVAS_WIDTH; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_HEIGHT);
        ctx.stroke();
      }

      // Draw Net
      ctx.fillStyle = "#27272a";
      ctx.fillRect(NET_X - NET_WIDTH / 2, NET_TOP_Y, NET_WIDTH, FLOOR_Y - NET_TOP_Y);
      
      // Draw Net Neon Top Bar
      ctx.fillStyle = "#ffffff";
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#f43f5e";
      ctx.fillRect(NET_X - NET_WIDTH / 2 - 2, NET_TOP_Y, NET_WIDTH + 4, 6);
      ctx.shadowBlur = 0; // reset

      // Draw Ground
      ctx.fillStyle = "#1e1b4b";
      ctx.fillRect(0, FLOOR_Y, CANVAS_WIDTH, CANVAS_HEIGHT - FLOOR_Y);
      // Neon floor strip
      ctx.fillStyle = "#4f46e5";
      ctx.shadowBlur = 15;
      ctx.shadowColor = "#6366f1";
      ctx.fillRect(0, FLOOR_Y, CANVAS_WIDTH, 4);
      ctx.shadowBlur = 0;

      if (gameState === "playing" || gameState === "point") {
        // --- 1. LOCAL LOGICS & ACTIONS ---

        // Player 1 controls (A / D, W to Jump) - Host or Local Only
        if (!isOnline || isHost) {
          const p1 = p1Ref.current;
          p1.vx = 0;
          if (keysRef.current["a"]) {
            p1.vx = -6;
          } else if (keysRef.current["d"]) {
            p1.vx = 6;
          }

          p1.x += p1.vx;
          // Boundary: keep P1 on left side of the net
          if (p1.x < PLAYER_RADIUS) p1.x = PLAYER_RADIUS;
          if (p1.x > NET_X - PLAYER_RADIUS - NET_WIDTH / 2 - 4) {
            p1.x = NET_X - PLAYER_RADIUS - NET_WIDTH / 2 - 4;
          }

          // Jump logic
          if (keysRef.current["w"] && !p1.isJumping) {
            p1.vy = -10.5;
            p1.isJumping = true;
            playSound("bounce");
          }

          if (p1.isJumping) {
            p1.vy += GRAVITY;
            p1.y += p1.vy;
            if (p1.y >= FLOOR_Y) {
              p1.y = FLOOR_Y;
              p1.vy = 0;
              p1.isJumping = false;
            }
          }
        }

        // Player 2 controls (Arrow keys, ArrowUp to Jump)
        const p2 = p2Ref.current;
        if (!isOnline) {
          // Local play controls
          p2.vx = 0;
          if (keysRef.current["arrowleft"]) {
            p2.vx = -6;
          } else if (keysRef.current["arrowright"]) {
            p2.vx = 6;
          }

          p2.x += p2.vx;
          // Boundary: keep P2 on right side of the net
          if (p2.x > CANVAS_WIDTH - PLAYER_RADIUS) p2.x = CANVAS_WIDTH - PLAYER_RADIUS;
          if (p2.x < NET_X + PLAYER_RADIUS + NET_WIDTH / 2 + 4) {
            p2.x = NET_X + PLAYER_RADIUS + NET_WIDTH / 2 + 4;
          }

          // Jump logic
          if (keysRef.current["arrowup"] && !p2.isJumping) {
            p2.vy = -10.5;
            p2.isJumping = true;
            playSound("bounce");
          }

          if (p2.isJumping) {
            p2.vy += GRAVITY;
            p2.y += p2.vy;
            if (p2.y >= FLOOR_Y) {
              p2.y = FLOOR_Y;
              p2.vy = 0;
              p2.isJumping = false;
            }
          }
        } else if (!isHost) {
          // GUEST sends its movement commands
          let p2vx = 0;
          if (keysRef.current["arrowleft"]) {
            p2vx = -6;
          } else if (keysRef.current["arrowright"]) {
            p2vx = 6;
          }

          p2.x += p2vx;
          if (p2.x > CANVAS_WIDTH - PLAYER_RADIUS) p2.x = CANVAS_WIDTH - PLAYER_RADIUS;
          if (p2.x < NET_X + PLAYER_RADIUS + NET_WIDTH / 2 + 4) {
            p2.x = NET_X + PLAYER_RADIUS + NET_WIDTH / 2 + 4;
          }

          if (keysRef.current["arrowup"] && !p2.isJumping) {
            p2.vy = -10.5;
            p2.isJumping = true;
            playSound("bounce");
          }

          if (p2.isJumping) {
            p2.vy += GRAVITY;
            p2.y += p2.vy;
            if (p2.y >= FLOOR_Y) {
              p2.y = FLOOR_Y;
              p2.vy = 0;
              p2.isJumping = false;
            }
          }

          // Send guest position
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                type: "game:sync",
                payload: {
                  action: "p2:input",
                  x: p2.x,
                  y: p2.y,
                  vx: p2vx,
                  vy: p2.vy,
                  isJumping: p2.isJumping,
                },
              })
            );
          }
        }

        // --- 2. BALL PHYSICS (Authority of Host or Local) ---
        const ball = ballRef.current;
        if (!isOnline || isHost) {
          if (gameState === "playing") {
            // Apply gravity
            ball.vy += GRAVITY * 0.7; // slightly floatier volley gravity
            ball.x += ball.vx;
            ball.y += ball.vy;

            // --- Collisions with Outer Bounds ---
            // Left & Right Wall
            if (ball.x - ball.radius <= 0) {
              ball.x = ball.radius;
              ball.vx = -ball.vx * 0.85;
              playSound("bounce");
              spawnParticles(0, ball.y, "#ffffff", 5);
            } else if (ball.x + ball.radius >= CANVAS_WIDTH) {
              ball.x = CANVAS_WIDTH - ball.radius;
              ball.vx = -ball.vx * 0.85;
              playSound("bounce");
              spawnParticles(CANVAS_WIDTH, ball.y, "#ffffff", 5);
            }

            // Ceiling
            if (ball.y - ball.radius <= 0) {
              ball.y = ball.radius;
              ball.vy = -ball.vy * 0.85;
              playSound("bounce");
            }

            // --- Collision with Net ---
            // Vertical net region: y is between NET_TOP_Y and FLOOR_Y
            const overlapX = Math.abs(ball.x - NET_X) < ball.radius + NET_WIDTH / 2;
            const overlapY = ball.y + ball.radius > NET_TOP_Y && ball.y - ball.radius < FLOOR_Y;
            if (overlapX && overlapY) {
              // Hits Net!
              if (ball.y < NET_TOP_Y + 5) {
                // Top net corner bounce
                ball.y = NET_TOP_Y - ball.radius;
                ball.vy = -Math.abs(ball.vy) * 0.85;
                ball.vx += ball.vx > 0 ? 1 : -1;
              } else {
                // Side of Net bounce
                if (ball.x < NET_X) {
                  ball.x = NET_X - NET_WIDTH / 2 - ball.radius;
                  ball.vx = -Math.abs(ball.vx) * 0.85;
                } else {
                  ball.x = NET_X + NET_WIDTH / 2 + ball.radius;
                  ball.vx = Math.abs(ball.vx) * 0.85;
                }
              }
              playSound("bounce");
              spawnParticles(NET_X, ball.y, "#f43f5e", 8);
            }

            // --- Collisions with Players ---
            // Semicircles: we treat the head surface.
            // Center of head arc is at (px, py). Radius is PLAYER_RADIUS.
            [p1Ref.current, p2Ref.current].forEach((pl, idx) => {
              const dx = ball.x - pl.x;
              const dy = ball.y - pl.y;
              const distance = Math.sqrt(dx * dx + dy * dy);

              if (distance < PLAYER_RADIUS + ball.radius && ball.y <= pl.y + 10) {
                // Collision! Calculate Normal Angle
                const angle = Math.atan2(dy, dx);
                
                // Move ball out of player
                ball.x = pl.x + Math.cos(angle) * (PLAYER_RADIUS + ball.radius);
                ball.y = pl.y + Math.sin(angle) * (PLAYER_RADIUS + ball.radius);

                // Velocity reflect & boost based on angle
                const bouncePower = pl.isJumping ? 13 : 10;
                ball.vx = Math.cos(angle) * bouncePower + pl.vx * 0.45;
                ball.vy = Math.sin(angle) * bouncePower + pl.vy * 0.35;

                // Ensure it bounces upward!
                if (ball.vy > -3) ball.vy = -6;

                // Toggle spiked trail if jumped and smashed
                if (pl.isJumping && ball.vy < -7) {
                  ball.isSpiked = true;
                  playSound("spike");
                  addFloatText(ball.x, ball.y - 30, "HYPER SMASH!", "#ec4899");
                  spawnParticles(ball.x, ball.y, "#f43f5e", 20, true);
                } else {
                  ball.isSpiked = false;
                  playSound("bounce");
                  spawnParticles(ball.x, ball.y, idx === 0 ? "#06b6d4" : "#c084fc", 10);
                }
              }
            });

            // --- Score Check: Ball touching ground? ---
            if (ball.y + ball.radius >= FLOOR_Y) {
              ball.y = FLOOR_Y - ball.radius;
              ball.vy = 0;
              ball.vx = 0;

              if (ball.x < NET_X) {
                // Scores for Player 2 (Right side)
                handlePointScored("left");
              } else {
                // Scores for Player 1 (Left side)
                handlePointScored("right");
              }
            }
          }

          // Authoritative host broadcast state
          if (isOnline && socket && socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                type: "game:sync",
                payload: {
                  action: "host:state",
                  p1: p1Ref.current,
                  p2: p2Ref.current,
                  ball: ball,
                  scores: { p1: p1Score, p2: p2Score },
                  event: gameState === "point" ? "point" : "",
                  scorerName: pointScorer,
                },
              })
            );
          }
        }
      }

      // --- 3. DRAW RENDERING ELEMENTS ---

      // Semicircle Player 1 (Left)
      const p1 = p1Ref.current;
      ctx.save();
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, PLAYER_RADIUS, Math.PI, 0, false); // Semicircle top half
      ctx.fillStyle = "rgba(6, 182, 212, 0.25)";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#06b6d4";
      ctx.shadowBlur = 15;
      ctx.shadowColor = "#06b6d4";
      ctx.stroke();
      ctx.restore();

      // P1 Eyes / Helmet Details
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p1.x + 15, p1.y - 18, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#000000";
      ctx.beginPath();
      ctx.arc(p1.x + 17, p1.y - 18, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Semicircle Player 2 (Right)
      const p2 = p2Ref.current;
      ctx.save();
      ctx.beginPath();
      ctx.arc(p2.x, p2.y, PLAYER_RADIUS, Math.PI, 0, false); // Semicircle top half
      ctx.fillStyle = "rgba(192, 132, 252, 0.25)";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#c084fc";
      ctx.shadowBlur = 15;
      ctx.shadowColor = "#c084fc";
      ctx.stroke();
      ctx.restore();

      // P2 Eyes / Helmet Details
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p2.x - 15, p2.y - 18, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#000000";
      ctx.beginPath();
      ctx.arc(p2.x - 17, p2.y - 18, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Draw active particles trail for Ball
      const ball = ballRef.current;
      if (gameState === "playing" && Math.abs(ball.vx) + Math.abs(ball.vy) > 0.5) {
        particlesRef.current.push({
          x: ball.x,
          y: ball.y,
          vx: (Math.random() - 0.5) * 1.5,
          vy: (Math.random() - 0.5) * 1.5,
          color: ball.isSpiked ? "#f43f5e" : "#eab308",
          size: Math.random() * 3 + 2,
          alpha: 0.6,
        });
      }

      // Draw Ball
      ctx.save();
      ctx.shadowBlur = ball.isSpiked ? 25 : 12;
      ctx.shadowColor = ball.isSpiked ? "#f43f5e" : "#eab308";
      ctx.fillStyle = ball.isSpiked ? "#f43f5e" : "#facc15";
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();

      // Ball core inner glow
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(ball.x - 3, ball.y - 3, ball.radius * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Render Particle System
      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= 0.02;

        if (p.alpha <= 0) {
          particles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Render Floating Text System
      const floats = floatTextsRef.current;
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i];
        f.y -= 0.8;
        f.timer--;

        if (f.timer <= 0) {
          floats.splice(i, 1);
          continue;
        }

        ctx.fillStyle = f.color;
        ctx.font = "bold 13px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(f.text, f.x, f.y);
      }

      // Live scoreboard on canvas
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 24px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";

      // Score P1 (Left side)
      ctx.fillStyle = "#06b6d4";
      ctx.fillText(p1Score.toString(), CANVAS_WIDTH / 2 - 100, 50);
      
      // Score P2 (Right side)
      ctx.fillStyle = "#c084fc";
      ctx.fillText(p2Score.toString(), CANVAS_WIDTH / 2 + 100, 50);

      // VS Separator
      ctx.fillStyle = "#52525b";
      ctx.font = "14px 'JetBrains Mono', monospace";
      ctx.fillText("VS", CANVAS_WIDTH / 2, 45);

      // Serve/Indicator lines in center
      ctx.strokeStyle = "rgba(82, 82, 91, 0.3)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(NET_X, 0);
      ctx.lineTo(NET_X, NET_TOP_Y);
      ctx.stroke();
      ctx.setLineDash([]); // reset

      // Draw Player Names above heads
      ctx.font = "bold 11px 'Inter', sans-serif";
      ctx.fillStyle = "#a1a1aa";
      ctx.fillText(p1Name, p1.x, p1.y - PLAYER_RADIUS - 10);
      ctx.fillText(p2Name, p2.x, p2.y - PLAYER_RADIUS - 10);

      animFrameId = requestAnimationFrame(gameLoop);
    };

    animFrameId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animFrameId);
  }, [gameState, p1Score, p2Score, p1Name, p2Name, isOnline, isHost, socket]);

  return (
    <div className="flex flex-col items-center bg-black p-4 rounded-2xl border border-zinc-900 shadow-2xl relative max-w-full overflow-hidden" id="volley-sports-cabinet">
      
      {/* Top Banner Display */}
      <div className="w-full flex justify-between items-center bg-zinc-950/60 px-5 py-3 rounded-t-xl border-b border-zinc-900">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          <span className="font-extrabold text-xs text-indigo-300 font-mono uppercase tracking-wider">
            🏐 CYBER VOLLEYBALL DUEL
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-6 bg-black/60 px-4 py-1.5 rounded-lg border border-zinc-900 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              <span className="text-zinc-400 font-mono font-medium">{p1Name}:</span>
              <span className="text-white font-bold font-mono">{p1Score}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-purple-400" />
              <span className="text-zinc-400 font-mono font-medium">{p2Name}:</span>
              <span className="text-white font-bold font-mono">{p2Score}</span>
            </div>
          </div>

          <button
            onClick={() => setMuted(!muted)}
            className="p-1.5 bg-zinc-900 hover:bg-zinc-800 rounded-lg border border-zinc-800 transition"
            title={muted ? "Unmute sound synthesis" : "Mute audio"}
          >
            {muted ? <VolumeX className="w-4 h-4 text-zinc-500" /> : <Volume2 className="w-4 h-4 text-zinc-300" />}
          </button>
          
          <button
            onClick={onQuit}
            className="flex items-center gap-1.5 bg-zinc-900 hover:bg-red-950/30 text-zinc-400 hover:text-red-400 px-3 py-1.5 rounded-lg border border-zinc-800 hover:border-red-900/50 transition text-xs font-bold"
          >
            <LogOut className="w-3.5 h-3.5" />
            LEAVE
          </button>
        </div>
      </div>

      {/* Main Canvas Box with Overlays */}
      <div className="relative border border-zinc-900 bg-[#09090b] rounded-b-xl overflow-hidden shadow-inner select-none">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block max-w-full aspect-[800/450]"
        />

        {/* COUNTDOWN OVERLAY */}
        {gameState === "countdown" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/75 backdrop-blur-sm z-10">
            <span className="text-7xl font-extrabold font-mono text-transparent bg-clip-text bg-gradient-to-br from-indigo-400 to-pink-500 animate-scale-up">
              {countdown > 0 ? countdown : "GO!"}
            </span>
            <p className="text-xs text-zinc-400 font-mono uppercase tracking-widest mt-4">
              Match synchronizing... Get Ready!
            </p>
          </div>
        )}

        {/* POINT SCORED OVERLAY */}
        {gameState === "point" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-10">
            <span className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-amber-500 tracking-wider animate-bounce">
              POINT SCORED!
            </span>
            <p className="text-white text-lg font-bold font-mono mt-1">
              🏆 {pointScorer} is leading!
            </p>
            <p className="text-xs text-zinc-500 font-mono mt-3 uppercase">
              Preparing next serve...
            </p>
          </div>
        )}

        {/* COMPLETED CHAMPION SCREEN */}
        {gameState === "finished" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md z-10">
            <Award className="w-16 h-16 text-yellow-400 animate-bounce mb-3" />
            <h3 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 via-pink-500 to-amber-500 tracking-wider">
              DUEL COMPLETED!
            </h3>
            <p className="text-white text-2xl font-bold mt-2">
              🏆 {winner} rules the court!
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
                  id="volley-restart-btn"
                  onClick={handleRestart}
                  className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white px-6 py-3 rounded-lg font-bold tracking-wider transition hover:scale-105"
                >
                  <RotateCcw className="w-5 h-5" />
                  PLAY AGAIN
                </button>
              )}
              {isOnline && !isHost && (
                <div className="text-sm text-zinc-400 italic bg-zinc-900 border border-zinc-800 px-4 py-3 rounded-lg">
                  Waiting for host to trigger replay...
                </div>
              )}
              <button
                id="volley-exit-btn"
                onClick={onQuit}
                className="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-3 rounded-lg font-bold tracking-wider transition"
              >
                BACK TO LOBBY
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Controller Guide Display */}
      <div className="w-full grid grid-cols-2 gap-4 mt-4 max-w-lg bg-zinc-950/80 p-3.5 rounded-xl border border-zinc-900 text-xs">
        <div className="text-center border-r border-zinc-900 pr-3">
          <span className="block text-cyan-400 font-bold font-mono mb-1.5 uppercase">{p1Name}</span>
          <div className="flex justify-center items-center gap-1">
            <span className="bg-zinc-900 border border-zinc-850 px-2 py-0.5 rounded text-white font-bold font-mono">A</span>
            <span className="bg-zinc-900 border border-zinc-850 px-2 py-0.5 rounded text-white font-bold font-mono">D</span>
            <span className="text-zinc-500 font-mono">Move</span>
            <span className="bg-zinc-900 border border-zinc-850 px-2 py-0.5 rounded text-white font-bold font-mono ml-2">W</span>
            <span className="text-zinc-500 font-mono">Jump</span>
          </div>
        </div>
        <div className="text-center pl-3">
          <span className="block text-purple-400 font-bold font-mono mb-1.5 uppercase">{p2Name}</span>
          <div className="flex justify-center items-center gap-1">
            <span className="bg-zinc-900 border border-zinc-850 px-2 py-0.5 rounded text-white font-bold font-mono">◀</span>
            <span className="bg-zinc-900 border border-zinc-850 px-2 py-0.5 rounded text-white font-bold font-mono">▶</span>
            <span className="text-zinc-500 font-mono">Move</span>
            <span className="bg-zinc-900 border border-zinc-850 px-2 py-0.5 rounded text-white font-bold font-mono ml-2">▲</span>
            <span className="text-zinc-500 font-mono">Jump</span>
          </div>
        </div>
      </div>

      <div className="mt-4 w-full text-center text-[10px] text-zinc-500 font-mono">
        🏐 Smashes: Hit the ball while <span className="text-indigo-400 font-bold">jumping</span> to spike a heavy neon-charged shot with custom velocity angle!
      </div>
    </div>
  );
}
