import React, { useEffect, useRef, useState } from "react";
import { RaceObstacle, RacePlayerState } from "../types";
import { Play, RotateCcw, Volume2, VolumeX, Shield, Zap, Award, LogOut } from "lucide-react";

interface RaceGameProps {
  isOnline: boolean;
  isHost: boolean;
  socket: WebSocket | null;
  p1Name: string;
  p2Name: string;
  onQuit: () => void;
}

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 450;
const FINISH_DISTANCE = 3000; // Finish line at 3000 pixels/meters

export default function RaceGame({ isOnline, isHost, socket, p1Name, p2Name, onQuit }: RaceGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Sound state (simulated synth effects)
  const [muted, setMuted] = useState(true);

  // Game UI state
  const [gameState, setGameState] = useState<"countdown" | "playing" | "finished">("countdown");
  const [countdown, setCountdown] = useState(3);
  const [winner, setWinner] = useState<string | null>(null);
  const [currentLevel, setCurrentLevel] = useState(1);

  // Score details
  const [p1Score, setP1Score] = useState(0);
  const [p2Score, setP2Score] = useState(0);
  const [p1Dist, setP1Dist] = useState(0);
  const [p2Dist, setP2Dist] = useState(0);

  // Keep references to real-time positions for animation loop
  const p1Ref = useRef<RacePlayerState>({
    x: 50,
    y: 0,
    isJumping: false,
    isDucking: false,
    score: 0,
    speed: 5,
    distance: 0,
    finished: false,
    stunTimer: 0,
  });

  const p2Ref = useRef<RacePlayerState>({
    x: 50,
    y: 0,
    isJumping: false,
    isDucking: false,
    score: 0,
    speed: 5,
    distance: 0,
    finished: false,
    stunTimer: 0,
  });

  const obstaclesRef = useRef<RaceObstacle[]>([]);
  const scrollOffsetRef = useRef(0);
  const particlesRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; color: string; size: number; alpha: number }>>([]);
  const floatTextsRef = useRef<Array<{ x: number; y: number; text: string; color: string; timer: number }>>([]);

  // Setup keys
  const keysRef = useRef<Record<string, boolean>>({});
  const frameCountRef = useRef(0);

  // Audio synthethizer helper
  const playSound = (type: "jump" | "crash" | "powerup" | "start" | "win") => {
    if (muted) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === "jump") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(150, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } else if (type === "crash") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(120, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(40, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } else if (type === "powerup") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(300, ctx.currentTime);
        osc.frequency.setValueAtTime(450, ctx.currentTime + 0.08);
        osc.frequency.setValueAtTime(600, ctx.currentTime + 0.16);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      } else if (type === "start") {
        osc.type = "square";
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      } else if (type === "win") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(261.6, ctx.currentTime); // C
        osc.frequency.setValueAtTime(329.6, ctx.currentTime + 0.1); // E
        osc.frequency.setValueAtTime(392.0, ctx.currentTime + 0.2); // G
        osc.frequency.setValueAtTime(523.3, ctx.currentTime + 0.3); // High C
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      }
    } catch (e) {
      // AudioContext fails gracefully
    }
  };

  // Generate obstacles
  const initObstacles = (levelNum: number = 1) => {
    const list: RaceObstacle[] = [];
    let curX = 350;
    const types: Array<"low_spike" | "high_barrier" | "battery"> = ["low_spike", "high_barrier", "battery"];

    // Scale obstacle spacing and battery count with current level
    const spacingMult = Math.max(0.55, 1 - (levelNum - 1) * 0.08); // up to 45% closer hurdles
    const batteryChance = Math.max(0.12, 0.35 - (levelNum - 1) * 0.05); // less speed batteries
    const totalObstacles = 35 + levelNum * 5;

    for (let i = 0; i < totalObstacles; i++) {
      let type = types[Math.floor(Math.random() * types.length)];
      if (type === "battery" && Math.random() > (batteryChance / 0.33)) {
        // downgrade to low_spike or high_barrier
        type = Math.random() < 0.5 ? "low_spike" : "high_barrier";
      }

      list.push({
        id: `obs_${i}`,
        x: curX,
        type,
      });

      const baseSpacing = 180 + Math.floor(Math.random() * 150);
      curX += Math.max(110, Math.floor(baseSpacing * spacingMult));
    }
    obstaclesRef.current = list;
  };

  // Triggered once at mount
  useEffect(() => {
    // Generate obstacles locally if offline, or if online & Host
    if (!isOnline || isHost) {
      initObstacles(currentLevel);
      if (isOnline && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "game:sync",
            payload: {
              action: "obstacles:init",
              obstacles: obstaclesRef.current,
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

  // Set up socket listener for multiplayer sync
  useEffect(() => {
    if (!isOnline || !socket) return;

    const handleMessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "game:sync") {
          const payload = msg.payload;
          if (payload.action === "obstacles:init") {
            obstaclesRef.current = payload.obstacles;
          } else if (payload.action === "player:update") {
            // If we are Host, we receive updates from P2 (Guest)
            // If we are Guest, we receive updates from P1 (Host)
            if (isHost) {
              p2Ref.current = payload.playerState;
            } else {
              p1Ref.current = payload.playerState;
            }
          } else if (payload.action === "reset") {
            const nextLvl = payload.level || 1;
            setCurrentLevel(nextLvl);
            resetLocalState(nextLvl);
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

  // Set up key listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = true;
      keysRef.current[e.key] = true;

      // Prevent window scrolling for arrow keys & space
      if (["ArrowUp", "ArrowDown", " ", "Spacebar"].includes(e.key)) {
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

  // Spawn particles helper
  const spawnParticles = (x: number, y: number, color: string, count = 5) => {
    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 4 - 2,
        vy: (Math.random() - 0.5) * 4 - 2,
        color,
        size: Math.random() * 4 + 2,
        alpha: 1,
      });
    }
  };

  // Floating text feedback helper
  const addFloatText = (x: number, y: number, text: string, color: string) => {
    floatTextsRef.current.push({
      x,
      y,
      text,
      color,
      timer: 45,
    });
  };

  // Local reset helper
  const resetLocalState = (levelNum: number = currentLevel) => {
    p1Ref.current = {
      x: 50,
      y: 0,
      isJumping: false,
      isDucking: false,
      score: 0,
      speed: 5,
      distance: 0,
      finished: false,
      stunTimer: 0,
    };
    p2Ref.current = {
      x: 50,
      y: 0,
      isJumping: false,
      isDucking: false,
      score: 0,
      speed: 5,
      distance: 0,
      finished: false,
      stunTimer: 0,
    };
    initObstacles(levelNum);
    setCountdown(3);
    setGameState("countdown");
    setWinner(null);
    setP1Score(0);
    setP2Score(0);
    setP1Dist(0);
    setP2Dist(0);
    scrollOffsetRef.current = 0;
    particlesRef.current = [];
    floatTextsRef.current = [];
  };

  const handleRestart = (nextLevelNum?: number) => {
    const nextLvl = nextLevelNum !== undefined ? nextLevelNum : currentLevel;
    setCurrentLevel(nextLvl);
    resetLocalState(nextLvl);
    if (isOnline && socket && socket.readyState === WebSocket.OPEN) {
      // Sync restart
      socket.send(
        JSON.stringify({
          type: "game:sync",
          payload: { action: "reset", level: nextLvl },
        })
      );
      // Host sends fresh obstacles
      if (isHost) {
        setTimeout(() => {
          socket.send(
            JSON.stringify({
              type: "game:sync",
              payload: {
                action: "obstacles:init",
                obstacles: obstaclesRef.current,
              },
            })
          );
        }, 50);
      }
    }
  };

  // Main game loop
  useEffect(() => {
    let animFrame: number;

    const update = () => {
      if (gameState !== "playing") {
        render();
        animFrame = requestAnimationFrame(update);
        return;
      }

      frameCountRef.current++;

      const p1 = p1Ref.current;
      const p2 = p2Ref.current;

      // ----------------------------------------------------
      // Player 1 movement & input (W/S or Space/ArrowDown)
      // ----------------------------------------------------
      if (!isOnline || isHost) {
        // Jumping logic
        if (!p1.finished) {
          // If online and host, we control P1. If local, we control P1 with W/S or Space.
          const jumpKey = isOnline ? keysRef.current["w"] || keysRef.current[" "] : keysRef.current["w"];
          const duckKey = isOnline ? keysRef.current["s"] || keysRef.current["arrowdown"] : keysRef.current["s"];

          if (jumpKey && !p1.isJumping && !p1.isDucking) {
            p1.isJumping = true;
            p1.y = 1; // start off ground
            p1.speed += 0.5; // slight forward momentum
            playSound("jump");
            spawnParticles(p1.x + 20, 150 - p1.y, "#38bdf8", 8);
          }
          if (duckKey && !p1.isJumping) {
            p1.isDucking = true;
          } else if (!duckKey) {
            p1.isDucking = false;
          }

          if (p1.isJumping) {
            p1.y += p1.speed * 0.9;
            // Gravity effect
            p1.speed -= 0.6;
            if (p1.y <= 0) {
              p1.y = 0;
              p1.isJumping = false;
              p1.speed = p1.activePowerup === "boost" ? 11 : 7; // Restore base speed
              spawnParticles(p1.x + 20, 150, "#38bdf8", 5);
            }
          }

          // Move player forward (scales up by 15% per level)
          const p1LevelSpeedMult = 1 + (currentLevel - 1) * 0.15;
          let p1MoveSpeed = p1.activePowerup === "boost" ? 5 : 3;
          if (p1.stunTimer && p1.stunTimer > 0) {
            p1MoveSpeed = 0.8; // major slowdown when hit
            p1.stunTimer--;
          }
          p1.distance += p1MoveSpeed * p1LevelSpeedMult;
          p1.score += 1; // small pass-through points

          // Powerup handling
          if (p1.activePowerup) {
            if (p1.powerupTimer && p1.powerupTimer > 0) {
              p1.powerupTimer--;
            } else {
              p1.activePowerup = null;
            }
          }

          if (p1.distance >= FINISH_DISTANCE) {
            p1.distance = FINISH_DISTANCE;
            p1.finished = true;
            p1.finishTime = Date.now();
            spawnParticles(p1.x + 30, 120, "#eab308", 40);
            playSound("win");
          }
        }
      }

      // ----------------------------------------------------
      // Player 2 movement & input (ArrowUp / ArrowDown)
      // ----------------------------------------------------
      if (!isOnline || !isHost) {
        // If guest (online) we control p2. If local, we control p2 with ArrowUp/Down.
        const jumpKey = isOnline ? keysRef.current["arrowup"] || keysRef.current[" "] : keysRef.current["arrowup"];
        const duckKey = isOnline ? keysRef.current["arrowdown"] || keysRef.current["arrowdown"] : keysRef.current["arrowdown"];

        if (!p2.finished) {
          if (jumpKey && !p2.isJumping && !p2.isDucking) {
            p2.isJumping = true;
            p2.y = 1;
            p2.speed += 0.5;
            playSound("jump");
            spawnParticles(p2.x + 20, 350 - p2.y, "#a855f7", 8);
          }
          if (duckKey && !p2.isJumping) {
            p2.isDucking = true;
          } else if (!duckKey) {
            p2.isDucking = false;
          }

          if (p2.isJumping) {
            p2.y += p2.speed * 0.9;
            p2.speed -= 0.6;
            if (p2.y <= 0) {
              p2.y = 0;
              p2.isJumping = false;
              p2.speed = p2.activePowerup === "boost" ? 11 : 7;
              spawnParticles(p2.x + 20, 350, "#a855f7", 5);
            }
          }

          const p2LevelSpeedMult = 1 + (currentLevel - 1) * 0.15;
          let p2MoveSpeed = p2.activePowerup === "boost" ? 5 : 3;
          if (p2.stunTimer && p2.stunTimer > 0) {
            p2MoveSpeed = 0.8; // major slowdown when hit
            p2.stunTimer--;
          }
          p2.distance += p2MoveSpeed * p2LevelSpeedMult;
          p2.score += 1;

          if (p2.activePowerup) {
            if (p2.powerupTimer && p2.powerupTimer > 0) {
              p2.powerupTimer--;
            } else {
              p2.activePowerup = null;
            }
          }

          if (p2.distance >= FINISH_DISTANCE) {
            p2.distance = FINISH_DISTANCE;
            p2.finished = true;
            p2.finishTime = Date.now();
            spawnParticles(p2.x + 30, 320, "#eab308", 40);
            playSound("win");
          }
        }
      }

      // Check race finish condition
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
        // Local mode single-finisher instant win trigger
        setGameState("finished");
        setWinner(p1Name);
      } else if (p2.finished && !isOnline && !p1.finished) {
        setGameState("finished");
        setWinner(p2Name);
      } else if (isOnline) {
        // Online mode: if one has finished and 3 seconds pass, end game
        if (p1.finished && !p2.finished && !p2.finishTime) {
          p2.finishTime = Date.now(); // artificial finish fallback
          setTimeout(() => {
            setGameState("finished");
            setWinner(p1.score > p2.score ? p1Name : p2Name);
          }, 2000);
        } else if (p2.finished && !p1.finished && !p1.finishTime) {
          p1.finishTime = Date.now();
          setTimeout(() => {
            setGameState("finished");
            setWinner(p2.score > p1.score ? p2Name : p1Name);
          }, 2000);
        }
      }

      // ----------------------------------------------------
      // Obstacles Collision & Scroll Offset
      // ----------------------------------------------------
      // The track scrolls with the player. Let's base scroll offset on average distance or own distance.
      // For online, each player has their camera scrolling centered on themselves, or they both see their absolute tracks.
      // Let's scroll the camera based on individual player tracks! P1 track centers on P1 distance, P2 track centers on P2 distance.
      // That's brilliant because both tracks scroll independently on the split screen, allowing P1 and P2 to see ahead!
      // Yes! In the renderer, we will render P1 track scrolled by P1's distance, and P2 track scrolled by P2's distance! This is extremely elegant and visually amazing!

      // Collisions P1 (Host or local)
      if (!isOnline || isHost) {
        obstaclesRef.current.forEach((obs) => {
          if (obs.collected) return;

          // Check P1 collision
          // X bounding: player is at relative X=50 + p1.distance. Obstacle is at obs.x.
          const playerAbsX = 50 + p1.distance;
          const distToObs = Math.abs(playerAbsX - obs.x);

          if (distToObs < 25) {
            if (obs.type === "battery") {
              obs.collected = true;
              p1.activePowerup = "boost";
              p1.powerupTimer = 180; // 3 seconds at 60fps
              p1.score += 250;
              playSound("powerup");
              addFloatText(150, 80, "+250 LIGHTSPEED!", "#eab308");
              spawnParticles(150, 110, "#eab308", 12);
            } else if (obs.type === "low_spike") {
              // must jump
              if (!p1.isJumping) {
                // crash
                obs.collected = true; // avoid multi crash
                p1.score = Math.max(0, p1.score - 150);
                p1.speed = 1; // heavy slowdown
                p1.stunTimer = 45; // slowed for 0.75s
                playSound("crash");
                addFloatText(150, 80, "-150 CRASH!", "#ef4444");
                spawnParticles(150, 130, "#ef4444", 15);
              }
            } else if (obs.type === "high_barrier") {
              // must duck
              if (!p1.isDucking) {
                obs.collected = true;
                p1.score = Math.max(0, p1.score - 150);
                p1.speed = 1;
                p1.stunTimer = 45; // slowed for 0.75s
                playSound("crash");
                addFloatText(150, 80, "-150 HEAD SLAM!", "#ef4444");
                spawnParticles(150, 100, "#ef4444", 15);
              }
            }
          }
        });
      }

      // Collisions P2 (Guest or local)
      if (!isOnline || !isHost) {
        obstaclesRef.current.forEach((obs) => {
          // Since client-side guest handles P2, or in local mode we handle both
          if (obs.collected) return;

          const playerAbsX = 50 + p2.distance;
          const distToObs = Math.abs(playerAbsX - obs.x);

          if (distToObs < 25) {
            if (obs.type === "battery") {
              obs.collected = true;
              p2.activePowerup = "boost";
              p2.powerupTimer = 180;
              p2.score += 250;
              playSound("powerup");
              addFloatText(150, 280, "+250 LIGHTSPEED!", "#eab308");
              spawnParticles(150, 310, "#eab308", 12);
            } else if (obs.type === "low_spike") {
              if (!p2.isJumping) {
                obs.collected = true;
                p2.score = Math.max(0, p2.score - 150);
                p2.speed = 1;
                p2.stunTimer = 45; // slowed for 0.75s
                playSound("crash");
                addFloatText(150, 280, "-150 CRASH!", "#ef4444");
                spawnParticles(150, 330, "#ef4444", 15);
              }
            } else if (obs.type === "high_barrier") {
              if (!p2.isDucking) {
                obs.collected = true;
                p2.score = Math.max(0, p2.score - 150);
                p2.speed = 1;
                p2.stunTimer = 45; // slowed for 0.75s
                playSound("crash");
                addFloatText(150, 280, "-150 HEAD SLAM!", "#ef4444");
                spawnParticles(150, 300, "#ef4444", 15);
              }
            }
          }
        });
      }

      // ----------------------------------------------------
      // Socket Synced Communication
      // ----------------------------------------------------
      if (isOnline && socket && socket.readyState === WebSocket.OPEN && frameCountRef.current % 3 === 0) {
        // Send state updates
        if (isHost) {
          socket.send(
            JSON.stringify({
              type: "game:sync",
              payload: {
                action: "player:update",
                playerState: p1,
              },
            })
          );
        } else {
          socket.send(
            JSON.stringify({
              type: "game:sync",
              payload: {
                action: "player:update",
                playerState: p2,
              },
            })
          );
        }
      }

      // Update particle physics (in-place backward loop to avoid GC overhead)
      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= 0.02;
        if (p.alpha <= 0) {
          particles.splice(i, 1);
        }
      }

      // Update floating texts (in-place backward loop to avoid GC overhead)
      const floats = floatTextsRef.current;
      for (let i = floats.length - 1; i >= 0; i--) {
        const t = floats[i];
        t.y -= 0.8;
        t.timer -= 1;
        if (t.timer <= 0) {
          floats.splice(i, 1);
        }
      }

      // Keep UI state synced for React score header (throttled to every 10 frames to avoid state thrashing)
      if (frameCountRef.current % 10 === 0 || p1.finished || p2.finished) {
        setP1Score(p1.score);
        setP2Score(p2.score);
        setP1Dist(p1.distance);
        setP2Dist(p2.distance);
      }

      render();
      animFrame = requestAnimationFrame(update);
    };

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Clear Screen with grid background
      ctx.fillStyle = "#09090b"; // zinc 950
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Render Tracks Split Line (Split screen horizontal lanes)
      ctx.strokeStyle = "#27272a"; // zinc 800
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, CANVAS_HEIGHT / 2);
      ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT / 2);
      ctx.stroke();

      // RENDER LANE 1 (TOP) - Player 1
      drawLane(ctx, 1, p1Ref.current, p1Name, "#06b6d4"); // Cyan

      // RENDER LANE 2 (BOTTOM) - Player 2
      drawLane(ctx, 2, p2Ref.current, p2Name, "#c084fc"); // Purple

      // Render overlay effects (Particles & Floating texts)
      particlesRef.current.forEach((p) => {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      floatTextsRef.current.forEach((t) => {
        ctx.save();
        ctx.globalAlpha = t.timer / 45;
        ctx.fillStyle = t.color;
        ctx.font = "bold 14px 'JetBrains Mono', monospace";
        ctx.fillText(t.text, t.x, t.y);
        ctx.restore();
      });
    };

    const drawLane = (
      ctx: CanvasRenderingContext2D,
      laneIndex: number,
      pState: RacePlayerState,
      playerName: string,
      color: string
    ) => {
      const startY = laneIndex === 1 ? 0 : CANVAS_HEIGHT / 2;
      const midY = startY + (CANVAS_HEIGHT / 4);
      const groundY = startY + 160;

      // Draw Grid scrolling background
      ctx.save();
      ctx.strokeStyle = "#18181b"; // zinc 900
      ctx.lineWidth = 1;
      const offset = (pState.distance) % 50;
      for (let x = -offset; x < CANVAS_WIDTH; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, startY);
        ctx.lineTo(x, startY + 225);
        ctx.stroke();
      }
      ctx.restore();

      // Draw Horizon Ground
      ctx.fillStyle = "#111827"; // gray 900
      ctx.fillRect(0, groundY, CANVAS_WIDTH, 5);

      // Draw Track line
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(CANVAS_WIDTH, groundY);
      ctx.stroke();
      ctx.shadowBlur = 0; // reset

      // Draw Obstacles for this track
      // Obstacle coordinates are in absolute x values.
      // We render them relative to player distance: draw x = obs.x - playerAbsX + viewportOffsetX (50)
      const playerAbsX = 50 + pState.distance;
      obstaclesRef.current.forEach((obs) => {
        const renderX = obs.x - playerAbsX + 50;

        // Render only if on-screen
        if (renderX > -50 && renderX < CANVAS_WIDTH + 50) {
          if (obs.type === "battery" && !obs.collected) {
            // Draw battery (energy cube)
            ctx.fillStyle = "#eab308"; // yellow
            ctx.shadowColor = "#eab308";
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.rect(renderX - 10, groundY - 50, 20, 20);
            ctx.fill();

            // battery lightning icon
            ctx.fillStyle = "#000000";
            ctx.font = "12px sans-serif";
            ctx.fillText("⚡", renderX - 6, groundY - 35);
            ctx.shadowBlur = 0;
          } else if (obs.type === "low_spike" && !obs.collected) {
            // Draw low spike barrier (red/orange hazard)
            ctx.fillStyle = "#ef4444"; // red
            ctx.shadowColor = "#ef4444";
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.moveTo(renderX - 15, groundY);
            ctx.lineTo(renderX, groundY - 30);
            ctx.lineTo(renderX + 15, groundY);
            ctx.closePath();
            ctx.fill();
            ctx.shadowBlur = 0;

            // Draw hazard stripes
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(renderX - 5, groundY - 10);
            ctx.lineTo(renderX + 5, groundY - 10);
            ctx.stroke();
          } else if (obs.type === "high_barrier" && !obs.collected) {
            // Draw high barrier (must duck under)
            ctx.fillStyle = "#3b82f6"; // blue
            ctx.shadowBlur = 8;
            ctx.shadowColor = "#3b82f6";
            // Arch banner hanging down
            ctx.fillRect(renderX - 15, groundY - 100, 30, 45);
            ctx.fillStyle = "#f59e0b"; // yellow hazard bar
            ctx.fillRect(renderX - 25, groundY - 55, 50, 10);
            ctx.shadowBlur = 0;

            // Caution text
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 8px sans-serif";
            ctx.fillText("DUCK", renderX - 11, groundY - 47);
          }
        }
      });

      // Draw Finish line banner
      const finishRenderX = FINISH_DISTANCE - playerAbsX + 50;
      if (finishRenderX > -100 && finishRenderX < CANVAS_WIDTH + 100) {
        ctx.save();
        ctx.strokeStyle = "#eab308";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(finishRenderX, startY + 20);
        ctx.lineTo(finishRenderX, groundY);
        ctx.stroke();

        // Checkered banner
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(finishRenderX - 40, startY + 30, 80, 25);
        ctx.fillStyle = "#000000";
        for (let bx = 0; bx < 4; bx++) {
          for (let by = 0; by < 2; by++) {
            if ((bx + by) % 2 === 0) {
              ctx.fillRect(finishRenderX - 40 + bx * 20, startY + 30 + by * 12.5, 20, 12.5);
            }
          }
        }

        ctx.fillStyle = "#eab308";
        ctx.font = "bold 10px 'JetBrains Mono'";
        ctx.fillText("FINISH", finishRenderX - 18, startY + 25);
        ctx.restore();
      }

      // Draw Player Character
      // X is always fixed relative to viewport (50). Y is vertical height.
      const playerX = 50;
      const playerY = groundY - pState.y;

      ctx.save();
      // Draw running dust particles when on ground and moving
      if (!pState.isJumping && gameState === "playing") {
        if (Math.random() < 0.25) {
          spawnParticles(playerX, groundY, color, 1);
        }
      }

      // Character body render
      ctx.shadowColor = color;
      ctx.shadowBlur = 15;
      ctx.fillStyle = color;

      if (pState.isDucking) {
        // Flat shape for ducking
        ctx.fillRect(playerX - 10, playerY - 15, 30, 15);
        // Head
        ctx.beginPath();
        ctx.arc(playerX + 22, playerY - 8, 7, 0, Math.PI * 2);
        ctx.fill();
        // Emojis overlay
        ctx.shadowBlur = 0;
        ctx.font = "20px sans-serif";
        ctx.fillText("🏃", playerX - 12, playerY + 2);
      } else {
        // Standing / Jumping
        ctx.fillRect(playerX - 8, playerY - 35, 18, 30);
        // Head
        ctx.beginPath();
        ctx.arc(playerX + 1, playerY - 42, 8, 0, Math.PI * 2);
        ctx.fill();

        // Glowing trail when boosting
        if (pState.activePowerup === "boost") {
          ctx.strokeStyle = "#eab308";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(playerX - 25, playerY - 20);
          ctx.lineTo(playerX - 5, playerY - 20);
          ctx.stroke();
          ctx.font = "22px sans-serif";
          ctx.fillText("⚡", playerX - 12, playerY - 12);
        }

        ctx.shadowBlur = 0;
        ctx.font = "24px sans-serif";
        ctx.fillText(laneIndex === 1 ? "🏃‍♂️" : "🏃‍♀️", playerX - 12, playerY - 8);
      }
      ctx.restore();

      // Render Player HUD overlay on each track
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12px 'Inter', sans-serif";
      ctx.fillText(`${playerName} ${laneIndex === 1 ? "👑" : ""}`, 15, startY + 25);

      // Score
      ctx.fillStyle = color;
      ctx.font = "12px 'JetBrains Mono'";
      ctx.fillText(`SCORE: ${pState.score}`, 15, startY + 45);

      // Speed indicators
      ctx.fillStyle = "#a1a1aa";
      ctx.fillText(`SPD: ${(pState.activePowerup === "boost" ? "LIGHTSPEED ⚡" : "NORMAL")}`, 15, startY + 65);

      // Progress percentage
      const progressPercent = Math.min(100, Math.floor((pState.distance / FINISH_DISTANCE) * 100));
      ctx.fillStyle = "#27272a";
      ctx.fillRect(15, startY + 75, 150, 6);
      ctx.fillStyle = color;
      ctx.fillRect(15, startY + 75, (progressPercent / 100) * 150, 6);
      ctx.fillStyle = "#a1a1aa";
      ctx.font = "10px sans-serif";
      ctx.fillText(`${progressPercent}% (${Math.floor(pState.distance)}m)`, 175, startY + 81);
    };

    animFrame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animFrame);
  }, [gameState, muted, p1Name, p2Name]);

  return (
    <div className="flex flex-col items-center bg-black rounded-2xl overflow-hidden shadow-2xl border border-zinc-800 w-full max-w-4xl p-4 md:p-6" id="race-game-arena">
      {/* HUD Header */}
      <div className="flex flex-col md:flex-row md:justify-between items-center w-full mb-4 gap-2 pb-3 border-b border-zinc-800">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 tracking-wider">
            NEON SPEEDWAY <span className="text-white text-base ml-1.5 px-2 py-0.5 bg-zinc-900 border border-zinc-800 rounded-md font-mono">LVL {currentLevel}</span>
          </h2>
          <p className="text-xs text-zinc-400 font-mono">
            {isOnline ? "⚡ ONLINE SYNCHRONIZED MULTIPLAYER" : "⌨️ LOCAL SPLIT KEYBOARD"}
          </p>
        </div>

        {/* Real-time score readout */}
        <div className="flex items-center gap-6 bg-zinc-950 px-4 py-2 rounded-lg border border-zinc-800">
          <div className="text-center">
            <span className="block text-xs font-semibold text-cyan-400">{p1Name}</span>
            <span className="font-mono text-lg font-bold text-white">{p1Score} pts</span>
          </div>
          <div className="text-zinc-700 text-lg font-bold font-mono">VS</div>
          <div className="text-center">
            <span className="block text-xs font-semibold text-purple-400">{p2Name}</span>
            <span className="font-mono text-lg font-bold text-white">{p2Score} pts</span>
          </div>
        </div>

        {/* Audio controls */}
        <div className="flex items-center gap-2">
          <button
            id="toggle-mute"
            onClick={() => setMuted(!muted)}
            className="p-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg transition"
            title={muted ? "Unmute sound" : "Mute sound"}
          >
            {muted ? <VolumeX className="w-5 h-5 text-red-500" /> : <Volume2 className="w-5 h-5 text-green-500" />}
          </button>
          <button
            id="quit-game"
            onClick={onQuit}
            className="flex items-center gap-1.5 px-3 py-2 bg-red-950/40 hover:bg-red-950 text-red-400 border border-red-900 rounded-lg text-sm transition font-medium"
          >
            <LogOut className="w-4 h-4" />
            Quit
          </button>
        </div>
      </div>

      {/* Screen Canvas Container */}
      <div className="relative w-full overflow-hidden bg-zinc-950 border border-zinc-800 rounded-xl" ref={containerRef}>
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="w-full h-auto block aspect-[16/9]"
        />

        {/* COUNTDOWN VIEW */}
        {gameState === "countdown" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm z-10 transition-all">
            <div className="text-center animate-bounce">
              <span className="text-7xl font-extrabold font-mono text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 to-amber-500">
                {countdown}
              </span>
              <p className="text-zinc-400 tracking-widest uppercase mt-4 text-sm font-semibold">
                Get Ready... Space Speedway
              </p>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-8 max-w-md bg-zinc-900/80 p-4 rounded-xl border border-zinc-800">
              <div className="text-center border-r border-zinc-800 pr-4">
                <span className="block text-cyan-400 font-bold mb-1">{p1Name} Controls</span>
                <span className="inline-block bg-zinc-950 border border-zinc-800 font-mono text-xs text-white px-2 py-1 rounded mx-0.5">W</span> Jump
                <span className="block mt-1"></span>
                <span className="inline-block bg-zinc-950 border border-zinc-800 font-mono text-xs text-white px-2 py-1 rounded mx-0.5">S</span> Slide
              </div>
              <div className="text-center pl-4">
                <span className="block text-purple-400 font-bold mb-1">{p2Name} Controls</span>
                <span className="inline-block bg-zinc-950 border border-zinc-800 font-mono text-xs text-white px-2 py-1 rounded mx-0.5">▲</span> Jump
                <span className="block mt-1"></span>
                <span className="inline-block bg-zinc-950 border border-zinc-800 font-mono text-xs text-white px-2 py-1 rounded mx-0.5">▼</span> Slide
              </div>
            </div>
          </div>
        )}

        {/* FINISHED VIEW */}
        {gameState === "finished" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md z-10">
            <Award className="w-16 h-16 text-yellow-400 animate-bounce mb-3" />
            <h3 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 to-amber-500 tracking-wider">
              LEVEL {currentLevel} COMPLETED!
            </h3>
            <p className="text-white text-xl font-bold mt-2">
              {winner === "Draw!" ? "🏁 It's a Perfect Draw!" : `👑 ${winner} Wins!`}
            </p>

            <div className="grid grid-cols-2 gap-8 my-6 bg-zinc-950/80 p-5 rounded-xl border border-zinc-800 min-w-[280px]">
              <div className="text-center border-r border-zinc-800 pr-4">
                <span className="text-xs text-zinc-400 block mb-1">{p1Name} Score</span>
                <span className="text-2xl font-mono font-bold text-cyan-400">{p1Score}</span>
                <span className="block text-xs text-zinc-500 mt-1">{Math.floor(p1Dist)}m reached</span>
              </div>
              <div className="text-center pl-4">
                <span className="text-xs text-zinc-400 block mb-1">{p2Name} Score</span>
                <span className="text-2xl font-mono font-bold text-purple-400">{p2Score}</span>
                <span className="block text-xs text-zinc-500 mt-1">{Math.floor(p2Dist)}m reached</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 justify-center">
              {(!isOnline || isHost) && (
                <>
                  <button
                    id="btn-next-level"
                    onClick={() => handleRestart(currentLevel + 1)}
                    className="flex items-center gap-2 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-white px-6 py-3 rounded-lg font-bold tracking-wider hover:scale-105 transition"
                  >
                    NEXT LEVEL ({currentLevel + 1}) 🚀
                  </button>
                  <button
                    id="btn-restart"
                    onClick={() => handleRestart(currentLevel)}
                    className="flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 px-4 py-3 rounded-lg font-bold tracking-wider hover:scale-105 transition border border-zinc-800"
                  >
                    <RotateCcw className="w-4 h-4" />
                    RETRY LEVEL
                  </button>
                </>
              )}
              {isOnline && !isHost && (
                <div className="text-sm text-zinc-400 italic bg-zinc-900 border border-zinc-800 px-4 py-3 rounded-lg">
                  Waiting for host to trigger level {currentLevel + 1}...
                </div>
              )}
              <button
                id="btn-quit"
                onClick={onQuit}
                className="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-3 rounded-lg font-bold tracking-wider transition hover:scale-105"
              >
                BACK TO LOBBY
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 w-full text-center text-xs text-zinc-500 font-sans">
        🚀 Pro Tip: Collect glowing yellow energy batteries <span className="text-yellow-400">⚡</span> for temporary supersonic speeds! Duck <span className="text-blue-400">DUCK</span> under high blue barriers, and jump <span className="text-red-500">▲</span> over spikes!
      </div>
    </div>
  );
}
