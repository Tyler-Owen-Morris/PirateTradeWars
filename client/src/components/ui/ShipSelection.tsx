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
import { SHIP_TYPES, SHIP_DESCRIPTIONS, SHIP_PRICES } from "@shared/gameConstants";
import PaymentModal from "./PaymentModal";

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

  // Log current state for debugging
  useEffect(() => {
    console.log("ShipSelection component state:", {
      selectedShip,
      playerName,
      connected,
      isRegistered,
      socketError,
      shipError,
    });
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
  const generatePirateName = () => {
    // Reset error and generate a random name
    useSocket.getState().resetError();
    const randomName = `pirate${Math.floor(Math.random() * 10000)}`;
    setPlayerName(randomName);
    localStorage.setItem("playerName", randomName);
  }

  const launchStripeCheckout = async (ship: any) => {
    try {
      // Call backend to create a Payment Intent
      const response = await fetch('/api/stripe/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipName: ship.name,
          amount: SHIP_PRICES[ship.name], // Amount in cents (e.g., $10.00 = 1000)
          currency: 'usd',
          playerName: playerName,
        }),
      });
      console.log("initiate payment response:", response)
      const { clientSecret } = await response.json();
      if (!clientSecret) throw new Error('Failed to create payment intent');

      // Open the payment modal
      setClientSecret(clientSecret);
      setShowPaymentModal(true);
    } catch (error) {
      console.error('Error initiating payment:', error);
      alert('Failed to initiate payment. Please try again.');
    }
  };

  const handlePaymentSuccess = () => {
    if (!selectedShip) {
      console.error('Cannot start game: missing ship');
      return;
    }
    // Called when payment succeeds
    register(playerName, selectedShip.name); // Proceed with registration
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

    if (selectedShip.isPaid) {
      // Launch Stripe checkout
      launchStripeCheckout(selectedShip);
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
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-b from-gray-900 to-gray-800 p-4 overflow-y-auto">
      <Card className="w-full max-w-4xl border-amber-500 border flex flex-col mb-20" style={{ maxHeight: '90vh' }}>
        <CardHeader className="bg-amber-900 text-white">
          <CardTitle className="text-2xl text-center">
            Choose Your <br />
            <span className="text-amber-100">Captain's Name</span> and <span className="text-amber-100">Ship</span>
          </CardTitle>
          {/* <CardDescription className="text-center text-amber-100">
            Select your vessel for your pirate adventure
            {playerName ? `, Captain ${playerName}` : ""}
          </CardDescription> */}
        </CardHeader>

        <CardContent className="mt-4 overflow-y-auto flex-1">
          {/* Always show player name input field */}
          <div className="mb-6">
            <label
              htmlFor="playerName"
              className="block text-sm font-medium mb-1 text-white"
            >
              Your Captain's Name:
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                id="playerName"
                className="px-3 py-2 bg-gray-100 border border-amber-300 rounded-md w-full"
                value={playerName}
                onChange={(e) => {
                  setPlayerName(e.target.value);
                  // Save to localStorage for persistence
                  localStorage.setItem("playerName", e.target.value);
                }}
                placeholder="Enter your name (min. 3 characters)"
              />
            </div>
          </div>
          {(shipError || socketError) && (
            <Alert variant="destructive" className="mb-4 text-white">
              {/* <p>{shipError}ship error</p>
              <p>{socketError}socket errro</p> */}
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {shipError || socketError}
                {socketError && socketError.includes("Name already taken") && (
                  <div className="mt-2">
                    <p>Please try a different name</p>

                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}
          <Alert variant="default" className="mb-4">

            <AlertDescription className="text-white">
              <p>
                <strong>Note:</strong> you may generate a random name if you're not feeling creative.
              </p>
            </AlertDescription>
            <Button
              onClick={generatePirateName}
              className="mt-2 bg-amber-700 hover:bg-amber-600 text-white py-1 px-3 rounded-md transition"
              size="sm"
              data-testid="cypress-generate-random-name-button"
            >
              Generate Random Name
            </Button>
          </Alert>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Free Ship: Sloop */}
            <Card
              className={`cursor-pointer transition-all transform hover:scale-105 ${selectedShip?.name === SHIP_TYPES.SLOOP
                ? "border-amber-500 border-4 shadow-lg shadow-amber-500/50 bg-amber-100"
                : "bg-gray-50 border-2 border-transparent"
                }`}
              onClick={() => handleShipSelect(SHIP_TYPES.SLOOP)}
              data-testid="cypress-sloop-card"
            >
              <CardHeader className="p-4 pb-2 bg-amber-100">
                <CardTitle className="text-lg text-amber-900">
                  The Sloop
                </CardTitle>
                <CardDescription className="text-xs">Free</CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-2">
                <div className="h-40 bg-blue-100 rounded-md flex items-center justify-center border border-amber-200">
                  <img
                    src="/images/ships/sloop.jpg"
                    alt="The Sloop"
                    className="object-cover h-full w-full rounded-md"
                  />
                </div>
                <div className="mt-4 text-xs">
                  <p className="mb-1">{SHIP_DESCRIPTIONS[SHIP_TYPES.SLOOP]}</p>
                  <ul className="space-y-1 mt-2">
                    <li>• Hull: 50 HP</li>
                    {/* <li>• Armor: 0%</li> */}
                    <li>• Cargo: 20 units</li>
                    {/* <li>• Speed: 5</li> */}
                    <li>• Cannons: 1 (5 dmg)</li>
                  </ul>
                </div>
              </CardContent>
            </Card>

            {/* Paid Ship: Brigantine */}
            <Card
              className={`cursor-pointer transition-all transform hover:scale-105 ${selectedShip?.name === SHIP_TYPES.BRIGANTINE
                ? "border-amber-500 border-4 shadow-lg shadow-amber-500/50 bg-amber-100"
                : "bg-gray-50 border-2 border-transparent"
                }`}
              onClick={() => handleShipSelect(SHIP_TYPES.BRIGANTINE)}
              data-testid="cypress-brigantine-card"
            >
              <CardHeader className="p-4 pb-2 bg-amber-100">
                <CardTitle className="text-lg text-amber-900">
                  The Brigantine
                </CardTitle>
                <CardDescription className="text-xs">
                  Premium Tier 1
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-2">
                <div className="h-40 bg-green-100 rounded-md flex items-center justify-center border border-amber-200">
                  <img
                    src="/images/ships/brigantine.jpg"
                    alt="The Brigantine"
                    className="object-cover h-full w-full rounded-md"
                  />
                </div>
                <div className="mt-4 text-xs">
                  <p className="mb-1">
                    {SHIP_DESCRIPTIONS[SHIP_TYPES.BRIGANTINE]}
                  </p>
                  <ul className="space-y-1 mt-2">
                    <li>• Hull: 150 HP</li>
                    {/* <li>• Armor: 10%</li> */}
                    <li>• Cargo: 40 units</li>
                    {/* <li>• Speed: 6</li> */}
                    <li>• Cannons: 2 (8 dmg)</li>
                  </ul>
                </div>
              </CardContent>
            </Card>

            {/* Paid Ship: Galleon */}
            <Card
              className={`cursor-pointer transition-all transform hover:scale-105 ${selectedShip?.name === SHIP_TYPES.GALLEON
                ? "border-amber-500 border-4 shadow-lg shadow-amber-500/50 bg-amber-100"
                : "bg-gray-50 border-2 border-transparent"
                }`}
              onClick={() => handleShipSelect(SHIP_TYPES.GALLEON)}
              data-testid="cypress-galleon-card"
            >
              <CardHeader className="p-4 pb-2 bg-amber-100">
                <CardTitle className="text-lg text-amber-900">
                  The Galleon
                </CardTitle>
                <CardDescription className="text-xs">
                  Premium Tier 2
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-2">
                <div className="h-40 bg-yellow-100 rounded-md flex items-center justify-center border border-amber-200">
                  <img
                    src="/images/ships/galleon.jpg"
                    alt="The Galleon"
                    className="object-cover h-full w-full rounded-md"
                  />
                </div>
                <div className="mt-4 text-xs">
                  <p className="mb-1">
                    {SHIP_DESCRIPTIONS[SHIP_TYPES.GALLEON]}
                  </p>
                  <ul className="space-y-1 mt-2">
                    <li>• Hull: 300 HP</li>
                    {/* <li>• Armor: 20%</li> */}
                    <li>• Cargo: 60 units</li>
                    {/* <li>• Speed: 7</li> */}
                    <li>• Cannons: 3 (12 dmg)</li>
                  </ul>
                </div>
              </CardContent>
            </Card>

            {/* Paid Ship: Man-o'-War */}
            <Card
              className={`cursor-pointer transition-all transform hover:scale-105 ${selectedShip?.name === SHIP_TYPES.MAN_O_WAR
                ? "border-amber-500 border-4 shadow-lg shadow-amber-500/50 bg-amber-100"
                : "bg-gray-50 border-2 border-transparent"
                }`}
              onClick={() => handleShipSelect(SHIP_TYPES.MAN_O_WAR)}
              data-testid="cypress-man-o-war-card"
            >
              <CardHeader className="p-4 pb-2 bg-amber-100">
                <CardTitle className="text-lg text-amber-900">
                  The Man-o'-War
                </CardTitle>
                <CardDescription className="text-xs">
                  Premium Tier 3
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-2">
                <div className="h-40 bg-red-100 rounded-md flex items-center justify-center border border-amber-200">
                  <img
                    src="/images/ships/man-o-war.jpg"
                    alt="The Man-o'-War"
                    className="object-cover h-full w-full rounded-md"
                  />
                </div>
                <div className="mt-4 text-xs">
                  <p className="mb-1">
                    {SHIP_DESCRIPTIONS[SHIP_TYPES.MAN_O_WAR]}
                  </p>
                  <ul className="space-y-1 mt-2">
                    <li>• Hull: 500 HP</li>
                    {/* <li>• Armor: 30%</li> */}
                    <li>• Cargo: 80 units</li>
                    {/* <li>• Speed: 8</li> */}
                    <li>• Cannons: 4 (15 dmg)</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>

        <CardFooter className="flex justify-center p-6 bg-amber-900 rounded-b-lg sticky bottom-0">
          <Button
            onClick={handleStartGame}
            disabled={
              !selectedShip || !playerName || playerName.length < 3 || loading
            }
            className="w-1/2 bg-amber-600 hover:bg-amber-700 text-white font-bold border-2 border-amber-200"
            size="lg"
            data-testid="cypress-start-game-button"
          >
            {loading ? "Preparing Ship..." : "Set Sail!"}
          </Button>
          {!playerName && (
            <p className="ml-4 text-sm text-amber-200">
              Enter your name first!
            </p>
          )}
          {playerName && playerName.length < 3 && (
            <p className="ml-4 text-sm text-amber-200">
              Name must be at least 3 characters
            </p>
          )}
        </CardFooter>
      </Card>
      {/* Payment modal */}
      {showPaymentModal && clientSecret && (
        <PaymentModal
          isOpen={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={handlePaymentSuccess}
          clientSecret={clientSecret}
          shipName={selectedShip?.name || ''}
          amount={selectedShip ? SHIP_PRICES[selectedShip.name] : 0}
        />
      )}
    </div>
  );
}
