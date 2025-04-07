import { storage } from "../storage";
import { gameState } from "./gameState";
import { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";

interface RegisterMessage {
  type: "register";
  name: string;
  shipType: string;
}

interface InputMessage {
  type: "input";
  rotationY?: number;
  speed?: number;
  direction?: { x: number; y: number; z: number };
  firing?: boolean;
}

interface TradeMessage {
  type: "trade";
  portId: number;
  action: "buy" | "sell";
  goodId: number;
  quantity: number;
}

interface ScuttleMessage {
  type: "scuttle";
}

type ClientMessage =
  | RegisterMessage
  | InputMessage
  | TradeMessage
  | ScuttleMessage;

// Handle new WebSocket connections
export function handleSocketConnection(ws: WebSocket) {
  let playerId: string | null = null;

  // Set up message handling
  ws.on("message", async (message) => {
    try {
      const data: ClientMessage = JSON.parse(message.toString());

      switch (data.type) {
        case "register":
          await handleRegister(ws, data);
          break;
        case "input":
          if (playerId) {
            handleInput(playerId, data);
          }
          break;
        case "trade":
          if (playerId) {
            await handleTrade(playerId, data);
          }
          break;
        case "scuttle":
          if (playerId) {
            await handleScuttle(playerId, ws);
          }
          break;
        default:
          sendError(ws, "Unknown message type");
      }
    } catch (error) {
      console.error("Error handling WebSocket message:", error);
      sendError(ws, "Invalid message format");
    }
  });

  // Handle disconnection
  ws.on("close", () => {
    if (playerId) {
      // Mark player as disconnected
      gameState.removeClient(playerId);
      console.log(`Player ${playerId} disconnected`);
    }
  });

  // Send initial message
  ws.send(
    JSON.stringify({
      type: "welcome",
      message: "Welcome to Pirate Odyssey!",
      timestamp: Date.now(),
    }),
  );

  // Handle player registration
  async function handleRegister(ws: WebSocket, data: RegisterMessage) {
    try {
      // Check if name is valid
      if (!data.name || data.name.trim().length < 3) {
        return sendError(ws, "Name must be at least 3 characters");
      }

      // Check if name is available
      const existingPlayer = await storage.getPlayerByName(data.name);
      if (existingPlayer) {
        return sendError(ws, "Name already taken");
      }

      // Get ship type
      const shipType = await storage.getShipType(data.shipType);
      if (!shipType) {
        return sendError(ws, "Invalid ship type");
      }

      // Create player in database
      const player = await storage.createPlayer({
        userId: 0, // Anonymous player
        name: data.name,
        shipType: data.shipType,
      });

      // Generate unique session ID
      playerId = uuidv4();

      // Register the player in game state
      gameState.addPlayer(
        playerId,
        player.id,
        player.name,
        player.shipType,
        shipType,
      );

      // Register client for updates
      gameState.registerClient(playerId, ws);

      // Send success response
      ws.send(
        JSON.stringify({
          type: "registered",
          playerId,
          ship: shipType,
          gold: player.gold,
          timestamp: Date.now(),
        }),
      );

      console.log(`Player ${player.name} registered with ID ${playerId}`);
    } catch (error) {
      console.error("Error registering player:", error);
      sendError(ws, "Failed to register player");
    }
  }

  // Handle player input
  function handleInput(playerId: string, data: InputMessage) {
    // Create update object with only defined properties
    const updateData: any = {};

    // Only include rotationY if it's defined (allows client to skip sending rotation)
    if (data.rotationY !== undefined) {
      updateData.rotationY = data.rotationY;
    }

    // Always include these properties
    if (data.speed !== undefined) updateData.speed = data.speed;
    if (data.direction) updateData.direction = data.direction;
    if (data.firing !== undefined) updateData.firing = data.firing;

    // Update player in game state with only the changed properties
    gameState.updatePlayer(playerId, updateData);

    // Handle firing separately
    if (data.firing) {
      gameState.fireCannonBall(playerId);
    }
  }

  // Handle trading
  async function handleTrade(playerId: string, data: TradeMessage) {
    try {
      const player = gameState.state.players[playerId];
      if (!player) {
        return;
      }

      // Get the port
      const port = await storage.getPort(data.portId);
      if (!port) {
        return sendError(ws, "Port not found");
      }

      // Check if player is near the port
      const dx = Math.min(
        Math.abs(player.x - port.x),
        5000 - Math.abs(player.x - port.x),
      );
      const dz = Math.min(
        Math.abs(player.z - port.z),
        5000 - Math.abs(player.z - port.z),
      );
      const distance = Math.sqrt(dx * dx + dz * dz);

      if (distance > port.safeRadius) {
        return sendError(ws, "Too far from port");
      }

      // Get the good
      const good = await storage.getGood(data.goodId);
      if (!good) {
        return sendError(ws, "Good not found");
      }

      // Get port goods
      const portGoods = await storage.getPortGoods(port.id);
      const portGood = portGoods.find((pg) => pg.goodId === data.goodId);
      if (!portGood) {
        return sendError(ws, "Good not available at this port");
      }

      // Get player inventory
      const inventory = await storage.getPlayerInventory(player.playerId);
      const inventoryItem = inventory.find(
        (item) => item.goodId === data.goodId,
      );
      const currentQuantity = inventoryItem ? inventoryItem.quantity : 0;

      if (data.action === "buy") {
        // Check if port has enough stock
        if (portGood.stock < data.quantity) {
          return sendError(ws, "Not enough stock available");
        }

        // Check if player has enough gold
        const totalCost = portGood.currentPrice * data.quantity;
        if (player.gold < totalCost) {
          return sendError(ws, "Not enough gold");
        }

        // Check if player has enough cargo space
        if (player.cargoUsed + data.quantity > player.cargoCapacity) {
          return sendError(ws, "Not enough cargo space");
        }

        // Update player gold
        player.gold -= totalCost;
        player.cargoUsed += data.quantity;

        // Update player inventory
        await storage.updatePlayerInventory(
          player.playerId,
          data.goodId,
          currentQuantity + data.quantity,
        );

        // Get updated inventory to send with response
        const updatedInventory = await storage.getPlayerInventory(
          player.playerId,
        );

        // Send success response
        ws.send(
          JSON.stringify({
            type: "tradeSuccess",
            action: "buy",
            good: good.name,
            quantity: data.quantity,
            price: portGood.currentPrice,
            totalCost,
            newGold: player.gold,
            cargoUsed: player.cargoUsed,
            gold: player.gold,
            inventory: updatedInventory,
            timestamp: Date.now(),
          }),
        );
      } else if (data.action === "sell") {
        // Check if player has enough of the good
        if (currentQuantity < data.quantity) {
          return sendError(ws, "Not enough goods to sell");
        }

        // Calculate sell price (can be different from buy price)
        const totalEarnings = portGood.currentPrice * data.quantity;

        // Update player gold
        player.gold += totalEarnings;
        player.cargoUsed -= data.quantity;

        // Update player inventory
        await storage.updatePlayerInventory(
          player.playerId,
          data.goodId,
          currentQuantity - data.quantity,
        );

        // Get updated inventory to send with response
        const updatedInventory = await storage.getPlayerInventory(
          player.playerId,
        );

        // Send success response
        ws.send(
          JSON.stringify({
            type: "tradeSuccess",
            action: "sell",
            good: good.name,
            quantity: data.quantity,
            price: portGood.currentPrice,
            totalEarnings,
            newGold: player.gold,
            cargoUsed: player.cargoUsed,
            gold: player.gold,
            inventory: updatedInventory,
            timestamp: Date.now(),
          }),
        );
      }

      // Update database
      await storage.updatePlayerGold(player.playerId, player.gold);
    } catch (error) {
      console.error("Error trading:", error);
      sendError(ws, "Failed to complete trade");
    }
  }

  // Handle scuttle ship (voluntary retirement)
  async function handleScuttle(playerId: string, ws: WebSocket) {
    try {
      const player = gameState.state.players[playerId];
      if (!player) {
        return sendError(ws, "Player not found");
      }

      console.log(
        `Player ${player.name} is scuttling their ship and registering score of ${player.gold}`,
      );

      try {
        // Add player to leaderboard with current gold as score
        await storage.addToLeaderboard({
          playerId: player.playerId,
          playerName: player.name,
          score: player.gold,
          // achievedAt is handled by the storage implementation
        });
        console.log("Successfully added player to leaderboard");
      } catch (leaderboardError) {
        console.error("Error adding to leaderboard:", leaderboardError);
      }

      // Get updated leaderboard
      const leaderboard = await storage.getLeaderboard(10);

      // Send game end message
      try {
        const gameEndMessage = {
          type: "gameEnd",
          reason: "scuttle",
          score: player.gold,
          message: "You scuttled your ship and joined the leaderboard!",
          leaderboard,
          timestamp: Date.now(),
        };
        console.log("Sending gameEnd message:", JSON.stringify(gameEndMessage));

        // Only send if the WebSocket is open
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(gameEndMessage));
          console.log("gameEnd message sent successfully");
        } else {
          console.warn("WebSocket not open, could not send gameEnd message");
        }
      } catch (sendError) {
        console.error("Error sending gameEnd message:", sendError);
      }

      // Remove player from game
      delete gameState.state.players[playerId];
      gameState.removeClient(playerId);

      // Set player as inactive in database
      await storage.setPlayerActive(player.playerId, false);

      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    } catch (error) {
      console.error("Error scuttling ship:", error);
      sendError(ws, "Failed to scuttle ship");
    }
  }
}

// Helper function to send error messages
function sendError(ws: WebSocket, message: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "error",
        message,
        timestamp: Date.now(),
      }),
    );
  }
}
