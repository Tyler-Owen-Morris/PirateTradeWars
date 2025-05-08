import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";
import { Button } from "./button";
import { useShip } from "@/lib/stores/useShip";
import { useGameState } from "@/lib/stores/useGameState";
import { useSocket } from "@/lib/stores/useSocket";
import { Alert, AlertDescription } from "./alert";
import { AlertCircle, Loader2 } from "lucide-react";
import { SHIP_TYPES, SHIP_DESCRIPTIONS, SHIP_PRICES, SHIP_STATS, SHIP_DISPLAY_NAMES } from "@shared/gameConstants";
import PaymentModal from "./PaymentModal";
import pirateNamesData from "./pirateNames.json";

export default function ShipSelection() {
  const {
    ships,
    selectedShip,
    fetchShips,
    selectShip,
    error: shipError,
  } = useShip();
  const { startGame, isRegistered } = useGameState();
  const { register, error: socketError, connected } = useSocket();
  const [loading, setLoading] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [tempPlayerId, setTempPlayerId] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  // Log current state for debugging
  useEffect(() => {
    // console.log("ShipSelection component state:", {
    //   selectedShip,
    //   playerName,
    //   connected,
    //   isRegistered,
    //   socketError,
    //   shipError,
    // });
  }, [
    selectedShip,
    playerName,
    connected,
    isRegistered,
    socketError,
    shipError,
  ]);

  // Get player name from URL parameter or local storage
  useEffect(() => {
    // Try to get from URL first
    const params = new URLSearchParams(window.location.search);
    const name = params.get("name");

    if (name) {
      console.log("Found name in URL:", name);
      setPlayerName(name);
    } else {
      // Try to get from localStorage
      const storedName = localStorage.getItem("playerName");
      if (storedName) {
        console.log("Found name in localStorage:", storedName);
        setPlayerName(storedName);
      }
    }
  }, []);

  // Fetch available ships when component mounts
  useEffect(() => {
    fetchShips();
  }, [fetchShips]);

  // Handle ship selection
  const handleShipSelect = (shipType: string) => {
    selectShip(shipType);
  };

  // Listen for successful registration
  useEffect(() => {
    // When isRegistered becomes true, it means registration was successful
    if (isRegistered && !socketError) {
      console.log("Registration confirmed successful, starting game");
      startGame();
    }
  }, [isRegistered, socketError, startGame]);

  // useEffect(() => {
  //   generatePirateName();
  // }, [])

  // generate random pirate name
  // const generatePirateName = () => {
  //   // Reset error and generate a random name
  //   useSocket.getState().resetError();
  //   const randomName = `pirate${Math.floor(Math.random() * 10000)}`;
  //   setPlayerName(randomName);
  //   localStorage.setItem("playerName", randomName);
  // }
  const generatePirateName = () => {
    // Reset error and generate a random name
    useSocket.getState().resetError();

    // Load name parts from JSON
    const { prefixes, middleNames, suffixes } = pirateNamesData;

    // Decide name structure with probabilities
    const structure = Math.random();
    let usePrefix = false;
    let useSuffix = false;
    if (structure < 0.3) {
      usePrefix = true; // Prefix + Middle Name (30%)
    } else if (structure < 0.6) {
      useSuffix = true; // Middle Name + Suffix (30%)
    } else {
      usePrefix = true;
      useSuffix = true; // Prefix + Middle Name + Suffix (40%)
    }

    // Select middle name
    const middleName = middleNames[Math.floor(Math.random() * middleNames.length)];

    let prefix = '';
    let prefixTags: string[] = [];
    if (usePrefix) {
      const prefixObj = prefixes[Math.floor(Math.random() * prefixes.length)];
      prefix = prefixObj.name;
      prefixTags = prefixObj.tags;
    }

    let suffix = '';
    if (useSuffix) {
      let availableSuffixes = suffixes;
      if (usePrefix && prefixTags.includes('descriptor')) {
        // If prefix is a descriptor, filter out descriptor suffixes
        availableSuffixes = suffixes.filter(s => !s.tags.includes('descriptor'));
      }
      const suffixObj = availableSuffixes[Math.floor(Math.random() * availableSuffixes.length)];
      suffix = suffixObj.name;
    }

    // Construct the full name, filtering out empty parts
    const fullName = [prefix, middleName, suffix].filter(part => part !== '').join(' ');

    setPlayerName(fullName);
    localStorage.setItem("playerName", fullName);
  };

  const checkNameAvailability = async (name: string): Promise<{ available: boolean; tempPlayerId?: string }> => {
    try {
      const response = await fetch(`/api/check-name?name=${encodeURIComponent(name)}`);
      if (!response.ok) throw new Error('Server error checking name');
      const data = await response.json();
      console.log("checkNameAvailability response:", data)
      if (!data.available) {
        alert('This name is already in use. Please choose a different name.');
        return { available: false };
      }
      return { available: true, tempPlayerId: data.tempPlayerId };
    } catch (error) {
      console.error('Error checking name availability:', error);
      setNameError("Name already in use by an active player");
      //alert('Failed to check name availability. Please try again.');
      return { available: false };
    }
  };

  const launchStripeCheckout = async (ship: any, tempPlayerId: string) => {
    try {
      localStorage.removeItem('link_auth_session_client_secret');
      const response = await fetch('/api/stripe/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipName: ship.name,
          amount: SHIP_PRICES[ship.name],
          currency: 'usd',
          playerName: playerName,
          tempPlayerId,
        }),
      });
      console.log("initiate payment response:", response)
      const { clientSecret } = await response.json();
      if (!clientSecret) throw new Error('Failed to create payment intent');
      setClientSecret(clientSecret);
      setShowPaymentModal(true);
    } catch (error) {
      console.error('Error initiating payment:', error);
      //alert('Failed to initiate payment. Please try again.');
      setNameError("Failed to initiate payment. Please try again.");
      // Release the name reservation on failure
      await fetch('/api/release-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: playerName, tempPlayerId }),
      });
    }
  };

  const handlePaymentSuccess = () => {
    if (!selectedShip || !tempPlayerId) {
      console.error('Cannot start game: missing ship or tempPlayerId');
      return;
    }
    register(playerName, selectedShip.name, tempPlayerId);
  };

  const handlePaymentError = (error: { message: string; type?: string; code?: string }) => {
    const errorMessage = error.message || 'Payment failed. Please try again.';
    setNameError(errorMessage);
    console.error("Payment error:", {
      message: errorMessage,
      type: error.type,
      code: error.code,
    });
    // Clear tempPlayerId to prevent reuse
    setTempPlayerId(null);
    // Release name reservation
    if (playerName && tempPlayerId) {
      fetch('/api/release-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: playerName, tempPlayerId }),
      }).catch((err) => console.error('Error releasing name:', err));
    }
    // Clear any premature playerId in localStorage
    localStorage.removeItem('playerId');
  };

  // Start game with selected ship
  const handleStartGame = async () => {
    if (!selectedShip || !playerName || playerName.length < 3) {
      console.log("Cannot start game: missing requirements", {
        hasShip: !!selectedShip,
        playerName,
        nameLength: playerName?.length,
      });
      return;
    }
    console.log("selectedShip:", selectedShip)

    // Clear any previous errors
    useSocket.getState().resetError();
    setNameError(null);

    if (selectedShip.isPaid) {
      const { available, tempPlayerId } = await checkNameAvailability(playerName);
      console.log("checkNameAvailability:", { available, tempPlayerId })
      if (available && tempPlayerId) {
        setTempPlayerId(tempPlayerId);
        launchStripeCheckout(selectedShip, tempPlayerId);
      }
    } else {
      // No payment required for free ship
      console.log(
        "Starting game with ship:",
        selectedShip.name,
        "and player name:",
        playerName,
      );
      setLoading(true);
      try {
        // First connect to WebSocket if not connected
        if (!connected) {
          console.log("Connecting to WebSocket...");
          useSocket.getState().connect();
        }

        // Wait a moment for connection to establish if needed
        setTimeout(
          () => {
            try {
              // Register player with server through WebSocket
              console.log("Registering player with WebSocket...");
              register(playerName, selectedShip.name);

              // We don't immediately call startGame() here anymore
              // Instead, we wait for the registered event to be confirmed by the server
              // The useEffect above will handle starting the game when registration is successful

              // If there's an error, the loading state will be reset in the useEffect below
            } catch (innerError) {
              console.error("Error during game start sequence:", innerError);
              setLoading(false);
            }
          },
          connected ? 0 : 500,
        );
      } catch (error) {
        console.error("Error starting game:", error);
        setLoading(false);
      }
    }



  };

  // Reset loading state if there's an error
  useEffect(() => {
    if (socketError) {
      setLoading(false);
    }
  }, [socketError]);

  if (loading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-b from-gray-900 to-gray-800">
        <div className="flex flex-col items-center">
          <Loader2 className="h-12 w-12 text-amber-500 animate-spin" />
          <p className="mt-4 text-white text-lg">Preparing your ship...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-b from-gray-900 to-gray-800 p-4">
      <Card className="w-full max-w-5xl border-amber-500 border flex flex-col rounded-xl" style={{
        maxHeight: '83vh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        zIndex: 1
      }}>
        <CardHeader className="bg-amber-900 text-white rounded-t-xl sticky top-0" style={{
          zIndex: 1
        }}>
          <CardTitle className="text-2xl md:text-3xl text-center">
            Choose Your <span className="text-amber-100">Captain's Name</span> and <span className="text-amber-100">Ship</span>
          </CardTitle>
          <div className="mt-4">
            <label
              htmlFor="playerName"
              className="block text-sm font-medium mb-2 text-white"
            >
              Your Captain's Name:
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                id="playerName"
                className="px-3 py-2 bg-gray-100 text-black border border-amber-300 rounded-md w-full text-sm"
                value={playerName}
                onChange={(e) => {
                  setPlayerName(e.target.value);
                  localStorage.setItem("playerName", e.target.value);
                }}
                placeholder="Enter your name (min. 3 characters)"
              />
              <Button
                onClick={generatePirateName}
                className="bg-amber-700 hover:bg-amber-600 text-white py-2 px-4 rounded-md transition text-sm whitespace-nowrap"
                data-testid="cypress-generate-random-name-button"
              >
                Random Name
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          {(shipError || socketError || nameError) && (
            <Alert variant="destructive" className="mb-4 bg-red-900/90 border-red-700">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 mt-0.5 text-red-200" />
                <AlertDescription className="text-red-100">
                  {shipError || socketError || nameError}
                  {/* {socketError && socketError.includes("Name already in use") && (
                    <p className="mt-2 text-red-200">Please try a different name</p>
                  )} */}
                </AlertDescription>
              </div>
            </Alert>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                type: SHIP_TYPES.SLOOP,
                name: SHIP_DISPLAY_NAMES[SHIP_TYPES.SLOOP],
                tier: "Free",
                color: "blue-100",
                stats: {
                  price: "Free",
                  ttl: `${SHIP_STATS[SHIP_TYPES.SLOOP].playerTTL / 60} min`,
                  hull: `${SHIP_STATS[SHIP_TYPES.SLOOP].hullStrength} HP`,
                  cargo: `${SHIP_STATS[SHIP_TYPES.SLOOP].cargoCapacity} units`,
                  cannons: `${SHIP_STATS[SHIP_TYPES.SLOOP].cannonCount} (${SHIP_STATS[SHIP_TYPES.SLOOP].cannonDamage} dmg)`,
                  startingGold: `${SHIP_STATS[SHIP_TYPES.SLOOP].startingGold}`,
                },
                testId: "cypress-sloop-card",
              },
              {
                type: SHIP_TYPES.BRIGANTINE,
                name: SHIP_DISPLAY_NAMES[SHIP_TYPES.BRIGANTINE],
                tier: "Premium Tier 1",
                color: "green-100",
                stats: {
                  price: `$${(SHIP_PRICES[SHIP_TYPES.BRIGANTINE] / 100).toFixed(2)}`,
                  ttl: `${(SHIP_STATS[SHIP_TYPES.BRIGANTINE].playerTTL / 60) / 60} hour`,
                  hull: `${SHIP_STATS[SHIP_TYPES.BRIGANTINE].hullStrength} HP`,
                  cargo: `${SHIP_STATS[SHIP_TYPES.BRIGANTINE].cargoCapacity} units`,
                  cannons: `${SHIP_STATS[SHIP_TYPES.BRIGANTINE].cannonCount} (${SHIP_STATS[SHIP_TYPES.BRIGANTINE].cannonDamage} dmg)`,
                  startingGold: `${SHIP_STATS[SHIP_TYPES.BRIGANTINE].startingGold}`,
                },
                testId: "cypress-brigantine-card",
              },
              {
                type: SHIP_TYPES.GALLEON,
                name: SHIP_DISPLAY_NAMES[SHIP_TYPES.GALLEON],
                tier: "Premium Tier 2",
                color: "yellow-100",
                stats: {
                  price: `$${(SHIP_PRICES[SHIP_TYPES.GALLEON] / 100).toFixed(2)}`,
                  ttl: `${(SHIP_STATS[SHIP_TYPES.GALLEON].playerTTL / 60) / 60} hours`,
                  hull: `${SHIP_STATS[SHIP_TYPES.GALLEON].hullStrength} HP`,
                  cargo: `${SHIP_STATS[SHIP_TYPES.GALLEON].cargoCapacity} units`,
                  cannons: `${SHIP_STATS[SHIP_TYPES.GALLEON].cannonCount} (${SHIP_STATS[SHIP_TYPES.GALLEON].cannonDamage} dmg)`,
                  startingGold: `${SHIP_STATS[SHIP_TYPES.GALLEON].startingGold}`,
                },
                testId: "cypress-galleon-card",
              },
              {
                type: SHIP_TYPES.MAN_O_WAR,
                name: SHIP_DISPLAY_NAMES[SHIP_TYPES.MAN_O_WAR],
                tier: "Premium Tier 3",
                color: "red-100",
                stats: {
                  price: `$${(SHIP_PRICES[SHIP_TYPES.MAN_O_WAR] / 100).toFixed(2)}`,
                  ttl: `${(SHIP_STATS[SHIP_TYPES.MAN_O_WAR].playerTTL / 60) / 60} hours`,
                  hull: `${SHIP_STATS[SHIP_TYPES.MAN_O_WAR].hullStrength} HP`,
                  cargo: `${SHIP_STATS[SHIP_TYPES.MAN_O_WAR].cargoCapacity} units`,
                  cannons: `${SHIP_STATS[SHIP_TYPES.MAN_O_WAR].cannonCount} (${SHIP_STATS[SHIP_TYPES.MAN_O_WAR].cannonDamage} dmg)`,
                  startingGold: `${SHIP_STATS[SHIP_TYPES.MAN_O_WAR].startingGold}`,
                },
                testId: "cypress-man-o-war-card",
              },
            ].map((ship) => (
              <Card
                key={ship.type}
                className={`cursor-pointer transition-all transform hover:scale-105 rounded-xl overflow-hidden ${selectedShip?.name === ship.type
                  ? "border-amber-500 border-4 shadow-lg shadow-amber-500/50 bg-amber-50"
                  : "bg-gray-50 border-2 border-transparent"
                  }`}
                onClick={() => handleShipSelect(ship.type)}
                data-testid={ship.testId}
              >
                <CardHeader className="p-3 bg-amber-100 relative">
                  <CardTitle className="text-lg text-amber-900 pr-16">{ship.name}</CardTitle>
                  <CardDescription className="text-xs text-amber-700">{ship.tier}</CardDescription>
                  <div className="absolute top-3 right-3 bg-amber-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                    {ship.stats.price}
                  </div>
                </CardHeader>
                <CardContent className="p-3">
                  <div className={`h-32 bg-${ship.color} rounded-lg flex items-center justify-center border border-amber-200`}>
                    <img
                      src={`/images/ships/${ship.type.toLowerCase()}.jpg`}
                      alt={ship.name}
                      className="object-cover h-full w-full rounded-lg"
                    />
                  </div>
                  <div className="mt-3 text-xs text-gray-800">
                    <p className="mb-2 text-xsm h-10">{SHIP_DESCRIPTIONS[ship.type]}</p>
                    <ul className="space-y-1">
                      <li>
                        <span className="font-bold text-amber-700 text-sm">Persistence:</span>
                        <span className="ml-1 text-amber-600 font-semibold text-sm">{ship.stats.ttl}</span>
                      </li>
                      <li><span className="font-semibold">Hull:</span> {ship.stats.hull}</li>
                      <li><span className="font-semibold">Cargo:</span> {ship.stats.cargo}</li>
                      <li><span className="font-semibold">Cannons:</span> {ship.stats.cannons}</li>
                      <li><span className="font-semibold">Starting Gold:</span> {ship.stats.startingGold}</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>

        <CardFooter className="flex flex-col sm:flex-row items-center justify-center p-4 bg-amber-900 rounded-b-xl sticky bottom-0 gap-4" style={{
          paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 20px))',
          zIndex: 1
        }}>
          <Button
            onClick={handleStartGame}
            disabled={!selectedShip || !playerName || playerName.length < 3 || loading}
            className="w-full sm:w-1/3 bg-amber-600 hover:bg-amber-700 text-white font-bold border-2 border-amber-200 text-sm py-3 rounded-lg"
            data-testid="cypress-start-game-button"
          >
            {loading ? "Preparing Ship..." : "Set Sail!"}
          </Button>
          {!playerName && (
            <p className="text-sm text-amber-200 text-center">Enter your name first!</p>
          )}
          {playerName && playerName.length < 3 && (
            <p className="text-sm text-amber-200 text-center">Name must be at least 3 characters</p>
          )}
        </CardFooter>
      </Card>
      {showPaymentModal && clientSecret && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}>
          <PaymentModal
            isOpen={showPaymentModal}
            onClose={async () => {
              setShowPaymentModal(false);
              // Release name if payment was not successful
              if (!useSocket.getState().playerId) {
                await fetch('/api/release-name', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: playerName, tempPlayerId: tempPlayerId }),
                });
              }
            }}
            onSuccess={handlePaymentSuccess}
            onError={handlePaymentError}
            clientSecret={clientSecret}
            shipName={selectedShip?.name || ''}
            amount={selectedShip ? SHIP_PRICES[selectedShip.name] : 0}
          />
        </div>
      )}
    </div>
  );
}
