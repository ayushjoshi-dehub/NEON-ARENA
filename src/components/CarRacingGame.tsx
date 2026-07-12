import React, { useEffect, useRef, useState } from "react";
import { RotateCcw, Volume2, VolumeX, LogOut, Award, ShieldAlert, Zap } from "lucide-react";

interface CarRacingProps {
  isOnline: boolean;
  isHost: boolean;
  socket: WebSocket | null;
  p1Name: string;
  p2Name: string;
  onQuit: () => void;
}

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 450;
const RACE_FINISH_DISTANCE = 4000; // 4000 meters for a high-speed race

interface TrafficCar {
  id: string;
  x: number; // relative road X (0 to 180)
  y: number; // distance along track
  color: string;
  speed: number;
}

interface BoostPad {
  id: string;
  x: number;
  y: number;
}

interface RaceCarState {
  x: number; // position on road lane (-60 to +60 from center)
  distance: number;
  speed: number;
  nitroTimer: number;
  finished: boolean;
  finishTime?: number;
  score: number;
}

export default function CarRacingGame({ isOnline, isHost, socket, p1Name, p2Name, onQuit }: CarRacingProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Audio synthesis state
  const [muted, setMuted] = useState(true);

  // Game UI state
  const [gameState, setGameState] = useState<"countdown" | "playing" | "finished">("countdown");
  const [countdown, setCountdown] = useState(3);
  const [winner, setWinner] = useState<string | null>(null);
  const [currentLevel, setCurrentLevel] = useState(1);

  // Live distance progress for UI
  const [p1Dist, setP1Dist] = useState(0);
  const [p2Dist, setP2Dist] = useState(0);
  const [p1Score, setP1Score] = useState(0);
  const [p2Score, setP2Score] = useState(0);

  // Car states
  const p1Ref = useRef<RaceCarState>({
    x: 0,
    distance: 0,
    speed: 8,
    nitroTimer: 0,
    finished: false,
    score: 0,
  });

  const p2Ref = useRef<RaceCarState>({
    x: 0,
    distance: 0,
    speed: 8,
    nitroTimer: 0,
    finished: false,
    score: 0,
  });

  // Traffic and boost pads are generated based on track length
  const trafficRef = useRef<TrafficCar[]>([]);
  const boostRef = useRef<BoostPad[]>([]);
  const particlesRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; color: string; size: number; alpha: number }>>([]);
  const floatTextsRef = useRef<Array<{ x: number; y: number; text: string; color: string; timer: number }>>([]);

  const keysRef = useRef<Record<string, boolean>>({});
  const frameCountRef = useRef(0);

  // Audio synthesizer helper
  const playSound = (type: "engine" | "crash" | "nitro" | "start" | "win") => {
    if (muted) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === "engine") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(100, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(180, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } else if (type === "crash") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(160, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(30, ctx.currentTime + 0.4);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      } else if (type === "nitro") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.35);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } else if (type === "start") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(380, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } else if (type === "win") {
        osc.type = "square";
        osc.frequency.setValueAtTime(293.66, ctx.currentTime); // D
        osc.frequency.setValueAtTime(329.63, ctx.currentTime + 0.1); // E
        osc.frequency.setValueAtTime(392.00, ctx.currentTime + 0.2); // G
        osc.frequency.setValueAtTime(523.25, ctx.currentTime + 0.3); // High C
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.6);
        osc.start();
        osc.stop(ctx.currentTime + 0.6);
      }
    } catch (err) {
      // safe fallback
    }
  };

  const spawnParticles = (x: number, y: number, color: string, count = 10, vyOffset = 0) => {
    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6 + vyOffset,
        color,
        size: Math.random() * 4 + 2,
        alpha: 1,
      });
    }
  };

  const addFloatText = (x: number, y: number, text: string, color: string) => {
    floatTextsRef.current.push({ x, y, text, color, timer: 50 });
  };

  // Generate track objects
  const initTrack = (levelNum: number = 1) => {
    const traffic: TrafficCar[] = [];
    const boosts: BoostPad[] = [];

    // Spacing based on track distance
    let currentY = 500;
    const colors = ["#ef4444", "#3b82f6", "#10b981", "#a855f7", "#f59e0b"];

    // Difficulty scales with current level:
    // - Closer vehicle traffic spacing
    // - Faster traffic vehicle speed
    // - Less frequent speed boost pad generation
    const spacingMult = Math.max(0.6, 1 - (levelNum - 1) * 0.08); // up to 40% closer cars
    const boostChance = Math.max(0.15, 0.45 - (levelNum - 1) * 0.06); // fewer boosters
    const trafficSpeedBase = 1.5 + (levelNum - 1) * 0.45; // faster traffic vehicles

    while (currentY < RACE_FINISH_DISTANCE - 400) {
      // Traffic car
      traffic.push({
        id: `t_${currentY}`,
        x: (Math.random() - 0.5) * 110, // offset from center of lane (-55 to +55)
        y: currentY,
        color: colors[Math.floor(Math.random() * colors.length)],
        speed: trafficSpeedBase + Math.random() * 2, // traffic moves forward at level-scaled speed
      });

      // Boost pad spaced slightly after
      if (Math.random() < boostChance) {
        boosts.push({
          id: `b_${currentY}`,
          x: (Math.random() - 0.5) * 110,
          y: currentY + 140 + Math.random() * 100,
        });
      }

      const baseSpacing = 280 + Math.floor(Math.random() * 180);
      currentY += Math.max(120, Math.floor(baseSpacing * spacingMult));
    }

    trafficRef.current = traffic;
    boostRef.current = boosts;
  };

  // Setup countdown
  useEffect(() => {
    if (!isOnline || isHost) {
      initTrack(currentLevel);
      if (isOnline && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "game:sync",
            payload: {
              action: "car_track:init",
              traffic: trafficRef.current,
              boosts: boostRef.current,
            },
          })
        );
      }
    }
  }, []);

  // Handle countdown whenever gameState is set to "countdown"
  useEffect(() => {
    if (gameState !== "countdown") return;

    const cdInterval = setInterval(() => {
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

    return () => clearInterval(cdInterval);
  }, [gameState]);

  // Multi sync handler
  useEffect(() => {
    if (!isOnline || !socket) return;

    const handleMessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "game:sync") {
          const payload = msg.payload;

          if (payload.action === "car_track:init") {
            trafficRef.current = payload.traffic;
            boostRef.current = payload.boosts;
          } else if (payload.action === "car_player:update") {
            if (isHost) {
              p2Ref.current = payload.playerState;
            } else {
              p1Ref.current = payload.playerState;
            }
          } else if (payload.action === "car_reset") {
            const nextLvl = payload.level || 1;
            setCurrentLevel(nextLvl);
            resetLocalState(nextLvl);
          }
        }
      } catch (err) {
        console.error("Error reading car game sync message:", err);
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => {
      socket.removeEventListener("message", handleMessage);
    };
  }, [isOnline, isHost, socket]);

  // Keys listener
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

  const resetLocalState = (levelNum: number = currentLevel) => {
    p1Ref.current = { x: 0, distance: 0, speed: 8, nitroTimer: 0, finished: false, score: 0 };
    p2Ref.current = { x: 0, distance: 0, speed: 8, nitroTimer: 0, finished: false, score: 0 };
    setP1Dist(0);
    setP2Dist(0);
    setP1Score(0);
    setP2Score(0);
    initTrack(levelNum);
    setCountdown(3);
    setGameState("countdown");
    setWinner(null);
    particlesRef.current = [];
    floatTextsRef.current = [];
  };

  const handleRestart = (nextLevelNum?: number) => {
    const nextLvl = nextLevelNum !== undefined ? nextLevelNum : currentLevel;
    setCurrentLevel(nextLvl);
    resetLocalState(nextLvl);
    if (isOnline && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "game:sync",
          payload: { action: "car_reset", level: nextLvl },
        })
      );
      if (isHost) {
        setTimeout(() => {
          socket.send(
            JSON.stringify({
              type: "game:sync",
              payload: {
                action: "car_track:init",
                traffic: trafficRef.current,
                boosts: boostRef.current,
              },
            })
          );
        }, 50);
      }
    }
  };

  // Main Car Game update loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animFrame: number;

    const gameLoop = () => {
      // 1. UPDATE STATES IF PLAYING
      if (gameState === "playing") {
        frameCountRef.current++;
        const p1 = p1Ref.current;
        const p2 = p2Ref.current;

        // Player 1 input (WASD) - Host/Local
        if (!isOnline || isHost) {
          if (!p1.finished) {
            // Steering
            if (keysRef.current["a"]) p1.x -= 3.2;
            if (keysRef.current["d"]) p1.x += 3.2;

            // Boundaries
            if (p1.x < -60) p1.x = -60;
            if (p1.x > 60) p1.x = 60;

            // Base acceleration or Nitro speed
            const p1SpeedMult = 1 + (currentLevel - 1) * 0.12; // 12% faster per level
            if (p1.nitroTimer > 0) {
              p1.nitroTimer--;
              p1.speed = 8.5 * p1SpeedMult; // super nitro speed
            } else {
              p1.speed = 4.2 * p1SpeedMult; // standard racing speed
            }

            p1.distance += p1.speed;
            p1.score += Math.floor(p1.speed * 0.1);

            // Collide with traffic
            trafficRef.current.forEach((car) => {
              // check if car overlaps in Y distance and X offset
              const dy = Math.abs(p1.distance - car.y);
              const dx = Math.abs(p1.x - car.x);
              if (dy < 38 && dx < 24) {
                // Crash!
                p1.distance = Math.max(0, p1.distance - 150);
                p1.nitroTimer = 0;
                p1.score = Math.max(0, p1.score - 200);
                playSound("crash");
                addFloatText(150, 150, "-200 CRASH!", "#ef4444");
                spawnParticles(200, 320, "#ef4444", 25, 4);
                // push traffic car ahead
                car.y += 180;
              }
            });

            // Collide with boost pads
            boostRef.current.forEach((pad) => {
              const dy = Math.abs(p1.distance - pad.y);
              const dx = Math.abs(p1.x - pad.x);
              if (dy < 25 && dx < 22) {
                p1.nitroTimer = 90; // 1.5 seconds nitro
                p1.score += 500;
                playSound("nitro");
                addFloatText(200, 100, "+500 NITRO BOOST!", "#10b981");
                spawnParticles(200, 320, "#34d399", 20, 5);
                // move pad out of bounds
                pad.y = -1000;
              }
            });

            // Finish check
            if (p1.distance >= RACE_FINISH_DISTANCE) {
              p1.distance = RACE_FINISH_DISTANCE;
              p1.finished = true;
              p1.finishTime = Date.now();
              p1.score += 2000;
              playSound("win");
            }
          }

          // Broadcast host state
          if (isOnline && socket && socket.readyState === WebSocket.OPEN && frameCountRef.current % 3 === 0) {
            socket.send(
              JSON.stringify({
                type: "game:sync",
                payload: {
                  action: "car_player:update",
                  playerState: p1,
                },
              })
            );
          }
        }

        // Player 2 input (Arrow keys) - Guest/Local
        if (!isOnline || !isHost) {
          if (!p2.finished) {
            if (keysRef.current["arrowleft"]) p2.x -= 3.2;
            if (keysRef.current["arrowright"]) p2.x += 3.2;

            if (p2.x < -60) p2.x = -60;
            if (p2.x > 60) p2.x = 60;

            const p2SpeedMult = 1 + (currentLevel - 1) * 0.12;
            if (p2.nitroTimer > 0) {
              p2.nitroTimer--;
              p2.speed = 8.5 * p2SpeedMult;
            } else {
              p2.speed = 4.2 * p2SpeedMult;
            }

            p2.distance += p2.speed;
            p2.score += Math.floor(p2.speed * 0.1);

            // Collide traffic
            trafficRef.current.forEach((car) => {
              const dy = Math.abs(p2.distance - car.y);
              const dx = Math.abs(p2.x - car.x);
              if (dy < 38 && dx < 24) {
                p2.distance = Math.max(0, p2.distance - 150);
                p2.nitroTimer = 0;
                p2.score = Math.max(0, p2.score - 200);
                playSound("crash");
                addFloatText(550, 150, "-200 CRASH!", "#ef4444");
                spawnParticles(600, 320, "#ef4444", 25, 4);
                car.y += 180;
              }
            });

            // Collide boosts
            boostRef.current.forEach((pad) => {
              const dy = Math.abs(p2.distance - pad.y);
              const dx = Math.abs(p2.x - pad.x);
              if (dy < 25 && dx < 22) {
                p2.nitroTimer = 90;
                p2.score += 500;
                playSound("nitro");
                addFloatText(600, 100, "+500 NITRO BOOST!", "#10b981");
                spawnParticles(600, 320, "#a855f7", 20, 5);
                pad.y = -1000;
              }
            });

            if (p2.distance >= RACE_FINISH_DISTANCE) {
              p2.distance = RACE_FINISH_DISTANCE;
              p2.finished = true;
              p2.finishTime = Date.now();
              p2.score += 2000;
              playSound("win");
            }
          }

          // Broadcast guest state
          if (isOnline && socket && socket.readyState === WebSocket.OPEN && frameCountRef.current % 3 === 0) {
            socket.send(
              JSON.stringify({
                type: "game:sync",
                payload: {
                  action: "car_player:update",
                  playerState: p2,
                },
              })
            );
          }
        }

        // Live stats sync - throttled to every 10 frames to prevent React re-render thrashing
        if (frameCountRef.current % 10 === 0 || p1.finished || p2.finished) {
          setP1Dist(p1.distance);
          setP2Dist(p2.distance);
          setP1Score(p1.score);
          setP2Score(p2.score);
        }

        // Check overall completion
        if (p1.finished && p2.finished) {
          setGameState("finished");
          if (p1.score > p2.score) {
            setWinner(p1Name);
          } else if (p2.score > p1.score) {
            setWinner(p2Name);
          } else {
            setWinner("Draw!");
          }
        } else if (p1.finished && !isOnline && !p2.finished) {
          setGameState("finished");
          setWinner(p1Name);
        } else if (p2.finished && !isOnline && !p1.finished) {
          setGameState("finished");
          setWinner(p2Name);
        }
      }

      // 2. RENDER GRAPHICS
      ctx.fillStyle = "#09090b";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      const p1 = p1Ref.current;
      const p2 = p2Ref.current;

      // SPLIT SCREEN SEPARATOR
      ctx.strokeStyle = "#1e1b4b";
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(CANVAS_WIDTH / 2, 0);
      ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT);
      ctx.stroke();

      // RENDER LANE 1 (LEFT SIDE - PLAYER 1)
      renderLane(ctx, 0, p1, p1Name, "#06b6d4");

      // RENDER LANE 2 (RIGHT SIDE - PLAYER 2)
      renderLane(ctx, CANVAS_WIDTH / 2, p2, p2Name, "#c084fc");

      // RENDER FLOATING TEXTS & PARTICLES OVER EVERYTHING
      drawOverlaySystems(ctx);

      animFrame = requestAnimationFrame(gameLoop);
    };

    const renderLane = (
      ctx: CanvasRenderingContext2D,
      offsetX: number,
      carState: RaceCarState,
      name: string,
      neonColor: string
    ) => {
      const roadCenter = offsetX + CANVAS_WIDTH / 4;
      const roadWidth = 170;

      // Grass background
      ctx.fillStyle = "#020617";
      ctx.fillRect(offsetX, 0, CANVAS_WIDTH / 4 - roadWidth / 2, CANVAS_HEIGHT);
      ctx.fillRect(offsetX + CANVAS_WIDTH / 4 + roadWidth / 2, 0, CANVAS_WIDTH / 4 - roadWidth / 2, CANVAS_HEIGHT);

      // Cyber grid lines on grass
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 1;
      const grassYScroll = (carState.distance * 0.4) % 40;
      for (let y = -40; y < CANVAS_HEIGHT + 40; y += 40) {
        ctx.beginPath();
        ctx.moveTo(offsetX, y + grassYScroll);
        ctx.lineTo(offsetX + CANVAS_WIDTH / 4 - roadWidth / 2, y + grassYScroll);
        ctx.moveTo(offsetX + CANVAS_WIDTH / 4 + roadWidth / 2, y + grassYScroll);
        ctx.lineTo(offsetX + CANVAS_WIDTH / 2, y + grassYScroll);
        ctx.stroke();
      }

      // Asphalt Road
      ctx.fillStyle = "#0f0f13";
      ctx.fillRect(roadCenter - roadWidth / 2, 0, roadWidth, CANVAS_HEIGHT);

      // Neon Road Borders
      ctx.save();
      ctx.shadowBlur = 10;
      ctx.shadowColor = neonColor;
      ctx.strokeStyle = neonColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(roadCenter - roadWidth / 2, 0);
      ctx.lineTo(roadCenter - roadWidth / 2, CANVAS_HEIGHT);
      ctx.moveTo(roadCenter + roadWidth / 2, 0);
      ctx.lineTo(roadCenter + roadWidth / 2, CANVAS_HEIGHT);
      ctx.stroke();
      ctx.restore();

      // Yellow dashed center road divider lines (Scrolling)
      const dividerHeight = 35;
      const dividerGap = 25;
      const totalDividerPeriod = dividerHeight + dividerGap;
      const roadYScroll = carState.distance % totalDividerPeriod;

      ctx.strokeStyle = "#eab308";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      for (let y = -totalDividerPeriod; y < CANVAS_HEIGHT + totalDividerPeriod; y += totalDividerPeriod) {
        ctx.beginPath();
        ctx.moveTo(roadCenter, y + roadYScroll);
        ctx.lineTo(roadCenter, y + roadYScroll + dividerHeight);
        ctx.stroke();
      }

      // DRAW TRAFFIC & POWERUPS BASED ON CURRENT DISTANCE
      // Visible region relative to car distance:
      // Player car is rendered at constant Y = 320.
      // So if player's distance is pDist, then an object at distance objY is at:
      // screenY = 320 - (objY - pDist)
      const renderYOf = (objDist: number) => {
        return 320 - (objDist - carState.distance);
      };

      // Draw Boost Pads
      boostRef.current.forEach((pad) => {
        const sy = renderYOf(pad.y);
        if (sy > -50 && sy < CANVAS_HEIGHT + 50) {
          ctx.save();
          ctx.shadowBlur = 15;
          ctx.shadowColor = "#10b981";
          ctx.fillStyle = "rgba(16, 185, 129, 0.25)";
          ctx.beginPath();
          ctx.arc(roadCenter + pad.x, sy, 14, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = "#10b981";
          ctx.lineWidth = 3;
          ctx.stroke();

          // Chevron inside pad pointing up
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(roadCenter + pad.x - 5, sy + 3);
          ctx.lineTo(roadCenter + pad.x, sy - 4);
          ctx.lineTo(roadCenter + pad.x + 5, sy + 3);
          ctx.stroke();
          ctx.restore();
        }
      });

      // Draw Traffic Cars
      trafficRef.current.forEach((car) => {
        const sy = renderYOf(car.y);
        if (sy > -80 && sy < CANVAS_HEIGHT + 80) {
          // Slowly move traffic forward over time
          if (gameState === "playing") {
            car.y += car.speed * 0.12; // slow traffic advancement
          }

          ctx.save();
          ctx.shadowBlur = 6;
          ctx.shadowColor = car.color;
          ctx.fillStyle = car.color;

          // Main car body block
          ctx.fillRect(roadCenter + car.x - 11, sy - 20, 22, 38);

          // windshield/windows
          ctx.fillStyle = "#000000";
          ctx.fillRect(roadCenter + car.x - 8, sy - 10, 16, 12);
          ctx.fillStyle = "#38bdf8"; // glass blue
          ctx.fillRect(roadCenter + car.x - 7, sy - 8, 14, 6);

          // Tail neon lights
          ctx.fillStyle = "#ef4444";
          ctx.fillRect(roadCenter + car.x - 9, sy + 16, 4, 3);
          ctx.fillRect(roadCenter + car.x + 5, sy + 16, 4, 3);

          // Headlights
          ctx.fillStyle = "#facc15";
          ctx.fillRect(roadCenter + car.x - 9, sy - 20, 4, 2);
          ctx.fillRect(roadCenter + car.x + 5, sy - 20, 4, 2);

          ctx.restore();
        }
      });

      // DRAW PLAYER RACING CAR (Constant Y = 320)
      const carX = roadCenter + carState.x;
      const carY = 320;

      // Draw exhaust sparks if boosting
      if (carState.nitroTimer > 0 && Math.random() < 0.8) {
        spawnParticles(carX, carY + 22, "#10b981", 4, 5);
      }

      ctx.save();
      ctx.shadowBlur = carState.nitroTimer > 0 ? 25 : 12;
      ctx.shadowColor = neonColor;
      ctx.fillStyle = neonColor;

      // Sports Car Aero Body
      ctx.beginPath();
      ctx.moveTo(carX - 12, carY + 20);
      ctx.lineTo(carX - 13, carY - 12);
      ctx.lineTo(carX - 8, carY - 24);
      ctx.lineTo(carX + 8, carY - 24);
      ctx.lineTo(carX + 13, carY - 12);
      ctx.lineTo(carX + 12, carY + 20);
      ctx.closePath();
      ctx.fill();

      // Spoiler wing
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(carX - 16, carY + 16, 32, 5);
      ctx.fillStyle = neonColor;
      ctx.fillRect(carX - 16, carY + 13, 4, 8);
      ctx.fillRect(carX + 12, carY + 13, 4, 8);

      // Cyber Cabin canopy glass
      ctx.fillStyle = "#000000";
      ctx.fillRect(carX - 8, carY - 12, 16, 18);
      ctx.fillStyle = carState.nitroTimer > 0 ? "#10b981" : "#22d3ee";
      ctx.fillRect(carX - 7, carY - 10, 14, 10);

      // Wheels
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(carX - 15, carY - 18, 3, 10);
      ctx.fillRect(carX + 12, carY - 18, 3, 10);
      ctx.fillRect(carX - 15, carY + 8, 3, 10);
      ctx.fillRect(carX + 12, carY + 8, 3, 10);

      // Headlight glow
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(carX - 9, carY - 24, 4, 2);
      ctx.fillRect(carX + 5, carY - 24, 4, 2);

      ctx.restore();

      // FINISH LINE RENDERING
      const finishLineY = renderYOf(RACE_FINISH_DISTANCE);
      if (finishLineY > -100 && finishLineY < CANVAS_HEIGHT + 100) {
        ctx.fillStyle = "#ffffff";
        for (let bx = roadCenter - roadWidth / 2; bx < roadCenter + roadWidth / 2; bx += 16) {
          ctx.fillRect(bx, finishLineY, 8, 8);
          ctx.fillRect(bx + 8, finishLineY + 8, 8, 8);
        }
        ctx.fillStyle = "#000000";
        for (let bx = roadCenter - roadWidth / 2; bx < roadCenter + roadWidth / 2; bx += 16) {
          ctx.fillRect(bx + 8, finishLineY, 8, 8);
          ctx.fillRect(bx, finishLineY + 8, 8, 8);
        }

        ctx.font = "bold 13px 'JetBrains Mono', monospace";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.fillText("FINISH", roadCenter, finishLineY - 10);
      }

      // UI HUD Overlays inside lane
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.fillRect(offsetX + 10, 10, 160, 52);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.strokeRect(offsetX + 10, 10, 160, 52);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px 'Inter', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(name.toUpperCase(), offsetX + 16, 24);

      ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.fillStyle = neonColor;
      ctx.fillText(`DIST: ${Math.floor(carState.distance)}m / ${RACE_FINISH_DISTANCE}m`, offsetX + 16, 38);
      ctx.fillText(`SCORE: ${carState.score}`, offsetX + 16, 52);

      if (carState.nitroTimer > 0) {
        ctx.fillStyle = "#10b981";
        ctx.font = "bold 10px 'JetBrains Mono', monospace";
        ctx.fillText("⚡ NITRO FUEL ACTIVE", offsetX + 16, 76);
      }
    };

    const drawOverlaySystems = (ctx: CanvasRenderingContext2D) => {
      // 1. Particle Sparks
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

      // 2. Float Texts
      const floats = floatTextsRef.current;
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i];
        f.y -= 0.7;
        f.timer--;

        if (f.timer <= 0) {
          floats.splice(i, 1);
          continue;
        }

        ctx.fillStyle = f.color;
        ctx.font = "bold 12px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(f.text, f.x, f.y);
      }
    };

    animFrame = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animFrame);
  }, [gameState, p1Name, p2Name, isOnline, isHost, socket]);

  return (
    <div className="flex flex-col items-center bg-black p-4 rounded-2xl border border-zinc-900 shadow-2xl relative max-w-full overflow-hidden" id="car-racing-cabinet">
      
      {/* Top Bar Header */}
      <div className="w-full flex justify-between items-center bg-zinc-950/60 px-5 py-3 rounded-t-xl border-b border-zinc-900">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="font-extrabold text-xs text-cyan-300 font-mono uppercase tracking-wider">
            🏎️ CYBER HIGHWAY CAR RACING <span className="text-white text-[10px] ml-1.5 px-1.5 py-0.5 bg-zinc-900 border border-zinc-800 rounded font-mono">LVL {currentLevel}</span>
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-6 bg-black/60 px-4 py-1.5 rounded-lg border border-zinc-900 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              <span className="text-zinc-400 font-mono font-medium">{p1Name}:</span>
              <span className="text-white font-bold font-mono">{p1Score} pts</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-purple-400" />
              <span className="text-zinc-400 font-mono font-medium">{p2Name}:</span>
              <span className="text-white font-bold font-mono">{p2Score} pts</span>
            </div>
          </div>

          <button
            onClick={() => setMuted(!muted)}
            className="p-1.5 bg-zinc-900 hover:bg-zinc-800 rounded-lg border border-zinc-800 transition"
            title={muted ? "Unmute sounds" : "Mute audio"}
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

      {/* Canvas Area */}
      <div className="relative border border-zinc-900 bg-[#09090b] rounded-b-xl overflow-hidden shadow-inner select-none">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block max-w-full aspect-[800/450]"
        />

        {/* Live Race Progress HUD */}
        <div className="absolute bottom-4 left-4 right-4 bg-black/85 backdrop-blur border border-zinc-800 rounded-lg px-4 py-2 flex items-center justify-between text-[11px] font-mono gap-4">
          <div className="flex-1 flex items-center gap-2">
            <span className="text-cyan-400 font-bold uppercase shrink-0">{p1Name}</span>
            <div className="flex-1 bg-zinc-900 h-2 rounded overflow-hidden relative">
              <div
                className="bg-cyan-500 h-full rounded transition-all duration-75"
                style={{ width: `${Math.min(100, (p1Dist / RACE_FINISH_DISTANCE) * 100)}%` }}
              />
            </div>
            <span className="text-zinc-400 shrink-0">{Math.floor(p1Dist)}m</span>
          </div>

          <div className="text-zinc-600 font-bold shrink-0">TRACK PROGRESS</div>

          <div className="flex-1 flex items-center gap-2">
            <span className="text-purple-400 font-bold uppercase shrink-0">{p2Name}</span>
            <div className="flex-1 bg-zinc-900 h-2 rounded overflow-hidden relative">
              <div
                className="bg-purple-500 h-full rounded transition-all duration-75"
                style={{ width: `${Math.min(100, (p2Dist / RACE_FINISH_DISTANCE) * 100)}%` }}
              />
            </div>
            <span className="text-zinc-400 shrink-0">{Math.floor(p2Dist)}m</span>
          </div>
        </div>

        {/* COUNTDOWN OVERLAY */}
        {gameState === "countdown" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm z-10">
            <span className="text-7xl font-extrabold font-mono text-transparent bg-clip-text bg-gradient-to-br from-cyan-400 to-indigo-500 animate-scale-up">
              {countdown > 0 ? countdown : "ENGINES ON!"}
            </span>
            <p className="text-xs text-zinc-500 font-mono uppercase tracking-widest mt-4">
              Steer left/right to dodge traffic & collect green NITRO!
            </p>
          </div>
        )}

        {/* CHAMPION SCOREBOARD SCREEN */}
        {gameState === "finished" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 backdrop-blur-md z-10">
            <Award className="w-14 h-14 text-yellow-400 animate-bounce mb-2" />
            <h3 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 tracking-wider">
              LEVEL {currentLevel} GRAND PRIX COMPLETE!
            </h3>
            <p className="text-white text-2xl font-bold mt-2">
              🏆 {winner} wins the Cup!
            </p>

            <div className="flex gap-8 my-6 bg-zinc-950/80 p-5 rounded-xl border border-zinc-800 min-w-[300px] justify-center items-center">
              <div className="text-center">
                <span className="text-xs text-cyan-400 block mb-1 uppercase">{p1Name}</span>
                <span className="text-xl font-mono font-bold text-white">{p1Score} pts</span>
                <span className="text-[10px] block text-zinc-500 mt-1">{Math.floor(p1Dist)}m</span>
              </div>
              <div className="text-zinc-700 font-mono font-bold text-lg">vs</div>
              <div className="text-center">
                <span className="text-xs text-purple-400 block mb-1 uppercase">{p2Name}</span>
                <span className="text-xl font-mono font-bold text-white">{p2Score} pts</span>
                <span className="text-[10px] block text-zinc-500 mt-1">{Math.floor(p2Dist)}m</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 justify-center">
              {(!isOnline || isHost) && (
                <>
                  <button
                    id="btn-car-next-level"
                    onClick={() => handleRestart(currentLevel + 1)}
                    className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white px-6 py-2.5 rounded-lg font-bold tracking-wider hover:scale-105 transition"
                  >
                    NEXT LEVEL ({currentLevel + 1}) 🚀
                  </button>
                  <button
                    id="car-restart-btn"
                    onClick={() => handleRestart(currentLevel)}
                    className="flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 px-4 py-2.5 rounded-lg font-bold tracking-wider hover:scale-105 transition border border-zinc-800"
                  >
                    <RotateCcw className="w-4 h-4" />
                    RETRY LEVEL
                  </button>
                </>
              )}
              {isOnline && !isHost && (
                <div className="text-xs text-zinc-400 italic bg-zinc-900 border border-zinc-800 px-4 py-2.5 rounded-lg">
                  Waiting for host to trigger level {currentLevel + 1} GP...
                </div>
              )}
              <button
                id="car-exit-btn"
                onClick={onQuit}
                className="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-2.5 rounded-lg font-bold tracking-wider transition hover:scale-105"
              >
                ARCADE LOBBY
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Control Instruction Box */}
      <div className="w-full grid grid-cols-2 gap-4 mt-4 max-w-lg bg-zinc-950/80 p-3.5 rounded-xl border border-zinc-900 text-xs">
        <div className="text-center border-r border-zinc-900 pr-3">
          <span className="block text-cyan-400 font-bold font-mono mb-1.5 uppercase">{p1Name} CONTROLS</span>
          <div className="flex justify-center items-center gap-1.5">
            <span className="bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded text-white font-bold font-mono">A</span>
            <span className="bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded text-white font-bold font-mono">D</span>
            <span className="text-zinc-400 font-mono">Steer Left / Right</span>
          </div>
        </div>
        <div className="text-center pl-3">
          <span className="block text-purple-400 font-bold font-mono mb-1.5 uppercase">{p2Name} CONTROLS</span>
          <div className="flex justify-center items-center gap-1.5">
            <span className="bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded text-white font-bold font-mono">◀</span>
            <span className="bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded text-white font-bold font-mono">▶</span>
            <span className="text-zinc-400 font-mono">Steer Left / Right</span>
          </div>
        </div>
      </div>

      <div className="mt-3 text-center text-[10px] text-zinc-500 font-mono flex items-center gap-1.5">
        <ShieldAlert className="w-3.5 h-3.5 text-zinc-600" />
        Dodge slow cars to avoid massive deceleration penalties. Hit green chevrons for <span className="text-emerald-400 font-bold">NITRO HYPER SPEED</span>!
      </div>
    </div>
  );
}
